-- SOLO BASE LOCAL (Docker): se niega a correr si no se pasa -v local=si. Escribe en tablas reales.
\if :{?local}
\else
  \echo 'Falta -v local=si: este script es solo para la base local de pruebas.'
  \quit
\endif
-- Datos sintéticos con FORMA REALISTA para la base LOCAL. Referencia (un mes real): ~62 mil líneas, ~20 mil clientes
-- con compra, ~3 300 combinaciones empresa × canal × ruta × marca × producto.
-- 60 meses (nov 2021 – oct 2026): cada cliente tiene ruta, canal y empresa fijos y una canasta de 4 productos;
-- ~85 % de los clientes compra cada mes, 1–5 líneas. Casos límite: notas de crédito, clientes con venta sumada <= 0,
-- productos sin kg, líneas por otra ruta/canal (3 %), descripciones distintas del mismo producto, canales que se homologan.
\set ON_ERROR_STOP on
\timing on
set statement_timeout = 0;

insert into ventas.carga (id, nombre_archivo, sha256, bytes, estado)
values ('00000000-0000-4000-8000-000000000001', 'sintetico-60-meses.xlsx', 'sintetico-60-meses', 1, 'procesando');

insert into ventas.hecho (carga_id, hoja, fila_origen, fecha, anio, mes, ruta, empresa, marca, categoria, proveedor,
  cliente_codigo, cliente_nombre, zona, documento, grupo, canal_origen, canal, art_codigo, art_descrip, cantidad,
  venta_bruta, descuentos, venta_neta, kg, fardos_caja, subgrupo, sucursal)
select '00000000-0000-4000-8000-000000000001', 'Hoja' || m, (row_number() over ())::int,
  x.fecha, extract(year from x.fecha)::smallint, extract(month from x.fecha)::smallint,
  'R' || lpad(x.ruta::text, 3, '0') || ' ' || (array['Norte','Sur','Centro','Occidente','Oriente'])[x.ruta % 5 + 1],
  (array['BIA','INDECA'])[cli % 7 % 2 + 1],
  'Marca ' || (x.prod % 8 + 1),
  case when x.prod % 4 = 0 then 'Rep' else 'Café' end,
  'Proveedor ' || (x.prod % 6 + 1),
  'C' || lpad(cli::text, 6, '0'), 'Cliente ' || cli,
  'Zona ' || (x.ruta % 12 + 1),
  'F' || m || '-' || cli || '-' || (j / 2),
  'Grupo ' || (cli % 9 + 1),
  x.canal_origen, x.canal_origen,
  'A' || lpad(x.prod::text, 4, '0'),
  'Producto ' || x.prod || case when hh.h3 % 50 = 0 then ' (presentación nueva)' else '' end,
  x.cant,
  round(x.bruta, 2), round(x.bruta * x.desc_pct, 2), round(x.bruta, 2) - round(x.bruta * x.desc_pct, 2),
  case when x.prod % 37 = 0 then 0 else round(x.cant * (0.2 + x.prod % 9 * 0.1), 4) end,
  case when hh.h3 % 4 = 0 then null else round(x.cant / 12.0, 5) end,
  'Sub ' || (cli % 15 + 1),
  'Sucursal ' || (x.ruta % 8 + 1)
from generate_series(0, 59) m
cross join generate_series(0, 21999) cli
cross join lateral (select ('x' || substr(md5(m || ':' || cli), 1, 7))::bit(28)::int a) act
cross join lateral generate_series(1, 1 + act.a / 100 % 5) j
cross join lateral (select md5(m || ':' || cli || ':' || j) h) md
cross join lateral (select ('x' || substr(md.h, 1, 7))::bit(28)::int h1, ('x' || substr(md.h, 8, 7))::bit(28)::int h2,
                           ('x' || substr(md.h, 15, 7))::bit(28)::int h3, ('x' || substr(md.h, 22, 7))::bit(28)::int h4) hh
cross join lateral (
  select
    (make_date(2021, 11, 1) + (m || ' months')::interval + (hh.h4 % 27 || ' days')::interval)::date fecha,
    case when hh.h2 % 100 < 3 then hh.h2 % 60 else cli % 60 end ruta,
    (array['Detalle','Mayoreo','Moderno','Institucional','Gobierno','DETALLE','Exportacion','OMEZA','Mayoristas','Canal Nuevo'])
      [case when hh.h2 % 100 >= 97 then hh.h3 % 10 else cli % 10 end + 1] canal_origen,
    -- canasta de 4 productos por cliente, de 110
    (cli * 7 + hh.h3 % 4 * 13) % 110 prod,
    (hh.h4 % 40 + 1)::numeric cant,
    (case when hh.h1 % 100 < 4 or (cli % 53 = 0 and hh.h1 % 10 < 8) then -1 else 1 end)
      * (hh.h4 % 40 + 1) * (20 + (cli * 7 + hh.h3 % 4 * 13) % 110 % 50 * 3.37)::numeric bruta,
    (hh.h2 % 15) / 100.0 desc_pct
) x
where act.a % 100 < 85;

analyze ventas.hecho;
select ventas.cerrar_carga('00000000-0000-4000-8000-000000000001');
set role service_role;
select ventas.aprobar_carga('00000000-0000-4000-8000-000000000001', null, 'servicio', true, '[]'::jsonb, 'datos sintéticos');
select ventas.publicar('00000000-0000-4000-8000-000000000001', 'datos sintéticos', null, 'servicio');
reset role;
analyze;
select 'hecho' t, count(*) from ventas.hecho union all select 'resumen_mensual', count(*) from ventas.resumen_mensual
union all select 'resumen_cliente_mes', count(*) from ventas.resumen_cliente_mes;
select anio, mes, (select count(*) from ventas.hecho h where h.anio = vm.anio and h.mes = vm.mes) hecho,
  (select count(*) from ventas.resumen_mensual r where r.anio = vm.anio and r.mes = vm.mes) rm,
  (select count(*) from ventas.resumen_cliente_mes r where r.anio = vm.anio and r.mes = vm.mes) rc,
  (select count(distinct (empresa, cliente_codigo)) from ventas.resumen_cliente_mes r where r.anio = vm.anio and r.mes = vm.mes) clientes
from ventas.version_mes vm where vm.anio = 2026 and vm.mes >= 9;
