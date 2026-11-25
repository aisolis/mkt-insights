-- Lecturas del dashboard sobre resúmenes en vez de ventas.hecho (escala a millones de líneas).
--
-- Por qué: cada vista del dashboard lanza ~10 lecturas y casi todas recorrían las líneas de factura de los meses
-- pedidos (≈ 50–60 k por mes; 1.07 M en la historia real, varios millones a futuro). Con solo 61 754 líneas,
-- kpi_periodo ya costaba ≈ 350 ms de base y el resto 20–300 ms; /clientes, 4–7 s por consulta con la historia real
-- (0027). El costo crece en línea recta con las filas. Las líneas no cambian después de cerrar la carga (salvo la
-- re-homologación de canales de 0016, que vuelve a llamar ventas._llenar_resumen), así que los agregados se pueden
-- calcular UNA vez y leer después.
--
-- Qué:
-- 1. ventas.resumen_cliente_mes: venta por carga × mes × (empresa, cliente_codigo) × canal × ruta × marca, con filas,
--    venta_neta, kg y la última fecha con una línea de venta neta > 0. Es el grano mínimo que todavía reproduce, sin
--    aproximar, lo que no es sumable: "cliente con compra" = venta neta SUMADA del cliente en el periodo > 0 (S4, S24),
--    los estados de clientes (S22) y la ruta principal; y que responde los filtros empresa, canal, ruta y marca y el
--    ámbito por persona (empresa, canal, ruta; 0026). Sin producto: un cliente compra el mismo puñado de productos varias
--    veces al mes, así que el grano queda en el orden de "clientes activos × marcas" por mes (estimado 5–10 veces
--    menos filas que hecho; scripts/verificar-0029.sql lo mide). Con filtro de producto (art_codigo) estas lecturas
--    siguen en hecho: ahí el resumen no alcanza y se prefiere la cifra exacta.
-- 2. ventas.resumen_mensual (0003, sin cliente; 92 k filas contra 1.07 M) gana art_descrip = min(art_descrip) de su
--    grano: con eso el puente precio–volumen–mezcla (que muestra min(art_descrip) por producto) sale de ahí.
-- 3. Ambos se llenan donde ya se llenaba resumen_mensual: ventas._llenar_resumen, que llaman ventas.cerrar_carga (al
--    validar la carga, antes de publicar; desde 0008 la publicación ya no recorre hecho) y la re-homologación de 0016.
--    Se borran con su carga (FK on delete cascade). Se rellenan aquí para las cargas existentes.
-- 4. Funciones de lectura (mismo nombre, firma, JSON, envoltorio, dueño y permisos; solo cambia de dónde leen):
--      kpi_periodo, acumulado_anio, _clientes_estado (clientes_resumen y clientes_lista) → resumen_cliente_mes
--        (con filtro art_codigo → la implementación anterior, sobre hecho);
--      variacion_por_dimension (canal, ruta, marca, art_codigo, empresa), top_contribuyentes,
--        puente_precio_volumen_mezcla → resumen_mensual (zona, sucursal y categoría no están en el resumen → hecho).
--    Siguen en hecho: descomposicion (cuenta facturas: necesita el documento) y el nombre del cliente en
--    clientes_lista (una búsqueda por índice por fila de la página). serie_mensual y rutas_atipicas ya leían
--    resumen_mensual.
--    La implementación anterior de cada una queda como interno.<nombre>_v1 (renombrada, intacta): es la ruta de los
--    casos que el resumen no responde y la referencia de paridad de scripts/verificar-0029.sql.
--    Única diferencia intencional: en variacion_por_dimension y top_contribuyentes los empates de orden se desempatan
--    por valor (antes el orden entre empatados dependía del plan).
-- Ámbito: las dos tablas llevan empresa, canal y ruta y la misma política que hecho para lector_ventas; filtrar filas
-- del resumen por esas columnas es lo mismo que filtrar las líneas y después sumar.
--
-- Sin medir todavía (no hay base local): correr scripts/verificar-0029.sql en una copia antes de producción.

-- 1. Resumen por cliente -----------------------------------------------------------------------------------------
create table if not exists ventas.resumen_cliente_mes (
  carga_id uuid not null references ventas.carga(id) on delete cascade,
  anio smallint not null, mes smallint not null,
  empresa text not null, cliente_codigo text not null, canal text not null, ruta text not null, marca text not null,
  filas int not null, venta_neta numeric(16,2) not null, kg numeric(14,4) not null,
  ultima_venta date,  -- última fecha con una línea de venta neta > 0 (null si ninguna): "última compra" de /clientes
  primary key (carga_id, anio, mes, empresa, cliente_codigo, canal, ruta, marca)
);
comment on table ventas.resumen_cliente_mes is 'Venta por carga, mes, cliente (empresa + código), canal, ruta y marca. Se llena con ventas._llenar_resumen; lo leen kpi_periodo, acumulado_anio y clientes.';

-- Mismo patrón que hecho y resumen_mensual: RLS activo, nada para anon/authenticated, lectura solo para lector_ventas
-- dentro del ámbito de quien consulta (0026); service_role (ingesta, scripts) todo.
alter table ventas.resumen_cliente_mes enable row level security;
revoke all on ventas.resumen_cliente_mes from public, anon, authenticated;
grant all on ventas.resumen_cliente_mes to service_role;
grant select on ventas.resumen_cliente_mes to lector_ventas;
drop policy if exists "lector: resumen por cliente en su ámbito" on ventas.resumen_cliente_mes;
create policy "lector: resumen por cliente en su ámbito" on ventas.resumen_cliente_mes for select to lector_ventas using (
  (select interno.alcance_sesion()) is null or (
        ((select interno.alcance_lista('empresa')) is null or empresa = any((select interno.alcance_lista('empresa'))::text[]))
    and ((select interno.alcance_lista('canal')) is null or canal = any((select interno.alcance_lista('canal'))::text[]))
    and ((select interno.alcance_lista('ruta')) is null or ruta = any((select interno.alcance_lista('ruta'))::text[]))
  )
);

-- 2. Descripción en el resumen mensual (min del grano: el min de los min es el min de las líneas) ------------------
alter table ventas.resumen_mensual add column if not exists art_descrip text;

-- 3. Llenado: donde ya se llenaba resumen_mensual ------------------------------------------------------------------
create or replace function ventas._llenar_resumen_cliente(p_carga uuid) returns void language plpgsql as $$
begin
  delete from ventas.resumen_cliente_mes where carga_id = p_carga;
  insert into ventas.resumen_cliente_mes (carga_id, anio, mes, empresa, cliente_codigo, canal, ruta, marca, filas, venta_neta, kg, ultima_venta)
  select h.carga_id, h.anio, h.mes, h.empresa, h.cliente_codigo, h.canal, h.ruta, h.marca,
         count(*), sum(h.venta_neta), sum(h.kg), max(h.fecha) filter (where h.venta_neta > 0)
  from ventas.hecho h where h.carga_id = p_carga
  group by h.carga_id, h.anio, h.mes, h.empresa, h.cliente_codigo, h.canal, h.ruta, h.marca;
end $$;

-- Igual que en 0003 (mismas columnas y grano) más art_descrip y el resumen por cliente.
create or replace function ventas._llenar_resumen(p_carga uuid) returns void language plpgsql as $$
begin
  delete from ventas.resumen_mensual where carga_id = p_carga;
  insert into ventas.resumen_mensual (carga_id, anio, mes, empresa, canal, ruta, marca, art_codigo, filas, venta_neta, kg, art_descrip)
  select h.carga_id, h.anio, h.mes, h.empresa, h.canal, h.ruta, h.marca, h.art_codigo, count(*), sum(h.venta_neta), sum(h.kg), min(h.art_descrip)
  from ventas.hecho h where h.carga_id = p_carga
  group by h.carga_id, h.anio, h.mes, h.empresa, h.canal, h.ruta, h.marca, h.art_codigo;
  perform ventas._llenar_resumen_cliente(p_carga);
end $$;

revoke execute on function ventas._llenar_resumen_cliente(uuid), ventas._llenar_resumen(uuid) from public, anon, authenticated;
grant execute on function ventas._llenar_resumen_cliente(uuid), ventas._llenar_resumen(uuid) to service_role;

-- Cargas existentes. resumen_mensual no se reescribe (sus sumas alimentan la huella de aprobación de 0020/0021):
-- solo se le agrega la descripción. El resumen por cliente se arma para toda carga con líneas que no lo tenga.
update ventas.resumen_mensual r set art_descrip = s.d
from (
  select h.carga_id, h.anio, h.mes, h.empresa, h.canal, h.ruta, h.marca, h.art_codigo, min(h.art_descrip) d
  from ventas.hecho h
  group by h.carga_id, h.anio, h.mes, h.empresa, h.canal, h.ruta, h.marca, h.art_codigo
) s
where r.art_descrip is null
  and r.carga_id = s.carga_id and r.anio = s.anio and r.mes = s.mes and r.empresa = s.empresa
  and r.canal = s.canal and r.ruta = s.ruta and r.marca = s.marca and r.art_codigo = s.art_codigo;

select ventas._llenar_resumen_cliente(c.id) from ventas.carga c
where exists (select 1 from ventas.hecho h where h.carga_id = c.id)
  and not exists (select 1 from ventas.resumen_cliente_mes r where r.carga_id = c.id);

analyze ventas.resumen_cliente_mes;
analyze ventas.resumen_mensual;

-- 4. La implementación anterior queda como <nombre>_v1 (renombrada: mismo cuerpo, opciones, dueño y permisos) --------
do $$
declare
  f record;
begin
  for f in select * from (values
    ('kpi_periodo', 'int, int, int, int, int, jsonb'),
    ('variacion_por_dimension', 'int, text, int, int, int, int, jsonb'),
    ('top_contribuyentes', 'int, int, int, int, int, jsonb, int'),
    ('puente_precio_volumen_mezcla', 'int, int, int, int, int, jsonb, int'),
    ('acumulado_anio', 'int, int, int, jsonb'),
    ('_clientes_estado', 'int, int, int, int, int, jsonb')
  ) x(nombre, args)
  loop
    if to_regprocedure(format('interno.%s_v1(%s)', f.nombre, f.args)) is null then
      execute format('alter function interno.%I(%s) rename to %I', f.nombre, f.args, f.nombre || '_v1');
    end if;
  end loop;
end $$;

-- 5. Lecturas nuevas -------------------------------------------------------------------------------------------------
-- En todas: la composición de la versión (version_mes) se restringe también a los meses pedidos, para que el índice
-- (carga_id, anio, mes, …) de cada resumen se recorra solo en esos meses. Los filtros son los de ventas._where_filtros.

-- KPI del periodo (0003/0008). Sumas, rutas con movimiento y clientes con venta sumada > 0 (S4) salen igual del
-- resumen por cliente: sus filas existen si y solo si hay líneas con esa combinación.
create or replace function interno.kpi_periodo(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language plpgsql stable set plan_cache_mode = force_custom_plan as $$
begin
  if p_filtros->>'art_codigo' is not null then
    return interno.kpi_periodo_v1(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros);
  end if;
  return (
  with base as (
    select r.empresa, r.cliente_codigo, r.ruta, r.venta_neta, r.kg,
           (r.anio = p_anio and r.mes = p_mes) es_actual
    from ventas.resumen_cliente_mes r
    join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = p_version
    where ((vm.anio = p_anio and vm.mes = p_mes) or (vm.anio = p_anio_cmp and vm.mes = p_mes_cmp))
      and ((r.anio = p_anio and r.mes = p_mes) or (r.anio = p_anio_cmp and r.mes = p_mes_cmp))
      and (p_filtros->>'empresa' is null or r.empresa = p_filtros->>'empresa')
      and (p_filtros->>'canal'   is null or r.canal   = p_filtros->>'canal')
      and (p_filtros->>'ruta'    is null or r.ruta    = p_filtros->>'ruta')
      and (p_filtros->>'marca'   is null or r.marca   = p_filtros->>'marca')
  ),
  tot as (
    select es_actual, coalesce(sum(venta_neta), 0) vn, coalesce(sum(kg), 0) kg, count(distinct ruta) rutas
    from base group by es_actual
  ),
  cli as (
    select es_actual, count(*) cl from (
      select es_actual from base group by es_actual, empresa, cliente_codigo having sum(venta_neta) > 0
    ) s group by es_actual
  ),
  a as (select coalesce(t.vn, 0) vn, coalesce(t.kg, 0) kg, coalesce(t.rutas, 0) rutas, coalesce(c.cl, 0) cl
        from (select true k) x left join tot t on t.es_actual left join cli c on c.es_actual),
  c as (select coalesce(t.vn, 0) vn, coalesce(t.kg, 0) kg, coalesce(c.cl, 0) cl
        from (select false k) x left join tot t on not t.es_actual left join cli c on not c.es_actual)
  select jsonb_build_object(
    'venta_neta', a.vn, 'kg', a.kg, 'precio_kg', case when a.kg <> 0 then round(a.vn / a.kg, 2) end, 'clientes_con_compra', a.cl,
    'venta_neta_cmp', c.vn, 'kg_cmp', c.kg, 'precio_kg_cmp', case when c.kg <> 0 then round(c.vn / c.kg, 2) end, 'clientes_con_compra_cmp', c.cl,
    'rutas_con_venta', a.rutas, 'rutas_total', (select (metadatos->>'rutas_total')::int from ventas.publicacion where version = p_version))
  from a, c);
end $$;

-- Variación por dimensión (0008). Las dimensiones del resumen mensual salen de ahí; zona, sucursal y categoría, de hecho.
create or replace function interno.variacion_por_dimension(
  p_version int, p_dimension text, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language plpgsql stable as $$
declare r jsonb;
begin
  if p_dimension not in ('canal','ruta','zona','sucursal','marca','categoria','art_codigo','empresa') then
    raise exception 'dimension no permitida: %', p_dimension;
  end if;
  if p_dimension not in ('canal','ruta','marca','art_codigo','empresa') then
    return interno.variacion_por_dimension_v1(p_version, p_dimension, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros);
  end if;
  execute format($q$
    with g as (
      select r.%I valor,
        coalesce(sum(r.venta_neta) filter (where r.anio = $2 and r.mes = $3), 0) actual,
        coalesce(sum(r.venta_neta) filter (where r.anio = $4 and r.mes = $5), 0) anterior
      from ventas.resumen_mensual r
      join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = $1
      where ((vm.anio = $2 and vm.mes = $3) or (vm.anio = $4 and vm.mes = $5))
        and ((r.anio = $2 and r.mes = $3) or (r.anio = $4 and r.mes = $5))
        and ($6->>'empresa'    is null or r.empresa    = $6->>'empresa')
        and ($6->>'canal'      is null or r.canal      = $6->>'canal')
        and ($6->>'ruta'       is null or r.ruta       = $6->>'ruta')
        and ($6->>'marca'      is null or r.marca      = $6->>'marca')
        and ($6->>'art_codigo' is null or r.art_codigo = $6->>'art_codigo')
      group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object('valor', valor, 'actual', actual, 'anterior', anterior, 'variacion', actual - anterior)
                              order by actual - anterior, valor), '[]'::jsonb) from g
  $q$, p_dimension)
  into r using p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros;
  return r;
end $$;

-- Rutas que más contribuyen (0008): ruta × canal, del resumen mensual.
create or replace function interno.top_contribuyentes(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}', p_limite int default 10
) returns jsonb language sql stable as $$
  with g as (
    select r.ruta, r.canal,
      coalesce(sum(r.venta_neta) filter (where r.anio = p_anio and r.mes = p_mes), 0) actual,
      coalesce(sum(r.venta_neta) filter (where r.anio = p_anio_cmp and r.mes = p_mes_cmp), 0) anterior
    from ventas.resumen_mensual r
    join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = p_version
    where ((vm.anio = p_anio and vm.mes = p_mes) or (vm.anio = p_anio_cmp and vm.mes = p_mes_cmp))
      and ((r.anio = p_anio and r.mes = p_mes) or (r.anio = p_anio_cmp and r.mes = p_mes_cmp))
      and (p_filtros->>'empresa'    is null or r.empresa    = p_filtros->>'empresa')
      and (p_filtros->>'canal'      is null or r.canal      = p_filtros->>'canal')
      and (p_filtros->>'ruta'       is null or r.ruta       = p_filtros->>'ruta')
      and (p_filtros->>'marca'      is null or r.marca      = p_filtros->>'marca')
      and (p_filtros->>'art_codigo' is null or r.art_codigo = p_filtros->>'art_codigo')
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('ruta', ruta, 'canal', canal, 'actual', actual, 'anterior', anterior, 'variacion', actual - anterior)
                            order by abs(actual - anterior) desc, ruta, canal), '[]'::jsonb)
  from (select * from g order by abs(actual - anterior) desc, ruta, canal limit greatest(p_limite, 0)) t;
$$;

-- Puente precio–volumen–mezcla (0014, S23). Solo cambia el CTE g (del resumen mensual); el resto es el de 0014.
create or replace function interno.puente_precio_volumen_mezcla(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}', p_limite int default 5
) returns jsonb language plpgsql stable set plan_cache_mode = force_custom_plan as $$
begin
  return (
  with g as (
    select r.art_codigo, min(r.art_descrip) descripcion,
      coalesce(sum(r.venta_neta) filter (where r.anio = p_anio and r.mes = p_mes), 0) v1,
      coalesce(sum(r.kg)         filter (where r.anio = p_anio and r.mes = p_mes), 0) q1,
      coalesce(sum(r.venta_neta) filter (where r.anio = p_anio_cmp and r.mes = p_mes_cmp), 0) v0,
      coalesce(sum(r.kg)         filter (where r.anio = p_anio_cmp and r.mes = p_mes_cmp), 0) q0
    from ventas.resumen_mensual r
    join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = p_version
    where ((vm.anio = p_anio and vm.mes = p_mes) or (vm.anio = p_anio_cmp and vm.mes = p_mes_cmp))
      and ((r.anio = p_anio and r.mes = p_mes) or (r.anio = p_anio_cmp and r.mes = p_mes_cmp))
      and (p_filtros->>'empresa'    is null or r.empresa    = p_filtros->>'empresa')
      and (p_filtros->>'canal'      is null or r.canal      = p_filtros->>'canal')
      and (p_filtros->>'ruta'       is null or r.ruta       = p_filtros->>'ruta')
      and (p_filtros->>'marca'      is null or r.marca      = p_filtros->>'marca')
      and (p_filtros->>'art_codigo' is null or r.art_codigo = p_filtros->>'art_codigo')
    group by 1
  ),
  c as (
    select g.*, case when q0 > 0 and q1 > 0 then 'comparable' when q1 > 0 then 'nuevo' when q0 > 0 then 'descontinuado' else 'sin_volumen' end clase
    from g
  ),
  t as (
    select coalesce(sum(v1), 0) v1, coalesce(sum(v0), 0) v0,
      coalesce(sum(v1) filter (where clase = 'comparable'), 0) v1c, coalesce(sum(v0) filter (where clase = 'comparable'), 0) v0c,
      coalesce(sum(q1) filter (where clase = 'comparable'), 0) q1c, coalesce(sum(q0) filter (where clase = 'comparable'), 0) q0c,
      coalesce(sum(q1 * v0 / q0) filter (where clase = 'comparable'), 0) v1_a_p0,
      coalesce(sum(v1 - v0) filter (where clase = 'nuevo'), 0) nuevos,
      coalesce(sum(v1 - v0) filter (where clase = 'descontinuado'), 0) descontinuados,
      coalesce(sum(v1 - v0) filter (where clase = 'sin_volumen'), 0) sin_volumen,
      count(*) filter (where clase = 'comparable') n_comp, count(*) filter (where clase = 'nuevo') n_nuevos,
      count(*) filter (where clase = 'descontinuado') n_desc, count(*) filter (where clase = 'sin_volumen') n_sinvol
    from c
  ),
  e as (
    select t.*,
      case when q0c > 0 then round((q1c - q0c) * v0c / q0c, 2) else 0 end volumen,
      round(v1_a_p0 - v0c, 2) vol_mezcla,
      case when q0c > 0 then v0c / q0c end p0
    from t
  ),
  -- Efectos de cada producto comparable (suman el total salvo redondeo).
  d as (
    select c.art_codigo, c.descripcion, c.q1, c.q0, c.v1, c.v0,
      round(c.v1 / c.q1, 2) precio_kg, round(c.v0 / c.q0, 2) precio_kg_cmp,
      (e.q1c - e.q0c) * c.v0 / e.q0c ef_volumen,
      (c.q1 - e.q1c * c.q0 / e.q0c) * (c.v0 / c.q0 - e.p0) ef_mezcla,
      c.v1 - c.q1 * c.v0 / c.q0 ef_precio
    from c, e where c.clase = 'comparable'
  ),
  fila as (
    select d.*, jsonb_build_object('art_codigo', art_codigo, 'descripcion', descripcion, 'kg', q1, 'kg_cmp', q0,
      'venta_neta', v1, 'venta_neta_cmp', v0, 'precio_kg', precio_kg, 'precio_kg_cmp', precio_kg_cmp,
      'efecto_volumen', round(ef_volumen, 2), 'efecto_precio', round(ef_precio, 2), 'efecto_mezcla', round(ef_mezcla, 2)) j
    from d
  )
  select jsonb_build_object(
    'venta_neta', e.v1, 'venta_neta_cmp', e.v0, 'variacion', e.v1 - e.v0,
    'volumen', e.volumen, 'precio', (e.v1c - e.v0c) - e.vol_mezcla, 'mezcla', e.vol_mezcla - e.volumen,
    'nuevos', e.nuevos, 'descontinuados', e.descontinuados, 'sin_volumen', e.sin_volumen,
    'kg_comparables', e.q1c, 'kg_comparables_cmp', e.q0c,
    'precio_kg_comparables', case when e.q1c > 0 then round(e.v1c / e.q1c, 2) end,
    'precio_kg_comparables_cmp', case when e.q0c > 0 then round(e.v0c / e.q0c, 2) end,
    'productos_comparables', e.n_comp, 'productos_nuevos', e.n_nuevos, 'productos_descontinuados', e.n_desc,
    'productos_sin_volumen', e.n_sinvol,
    'detalle_precio', coalesce((select jsonb_agg(j order by abs(ef_precio) desc, art_codigo)
      from (select * from fila order by abs(ef_precio) desc, art_codigo limit greatest(p_limite, 0)) x), '[]'::jsonb),
    'detalle_mezcla', coalesce((select jsonb_agg(j order by abs(ef_mezcla) desc, art_codigo)
      from (select * from fila order by abs(ef_mezcla) desc, art_codigo limit greatest(p_limite, 0)) x), '[]'::jsonb),
    'principales_nuevos', coalesce((select jsonb_agg(jsonb_build_object('art_codigo', art_codigo, 'descripcion', descripcion, 'variacion', v1 - v0) order by abs(v1 - v0) desc, art_codigo)
      from (select * from c where clase = 'nuevo' order by abs(v1 - v0) desc, art_codigo limit 3) x), '[]'::jsonb),
    'principales_descontinuados', coalesce((select jsonb_agg(jsonb_build_object('art_codigo', art_codigo, 'descripcion', descripcion, 'variacion', v1 - v0) order by abs(v1 - v0) desc, art_codigo)
      from (select * from c where clase = 'descontinuado' order by abs(v1 - v0) desc, art_codigo limit 3) x), '[]'::jsonb))
  from e);
end $$;

-- Acumulado del año (0014, S24). Clientes con compra sobre la venta SUMADA del tramo: se suma el resumen por cliente.
create or replace function interno.acumulado_anio(p_version int, p_anio int, p_mes int, p_filtros jsonb default '{}')
returns jsonb language plpgsql stable set work_mem = '32MB' set plan_cache_mode = force_custom_plan as $$
begin
  if p_filtros->>'art_codigo' is not null then
    return interno.acumulado_anio_v1(p_version, p_anio, p_mes, p_filtros);
  end if;
  return (
  with por_cliente as (
    select r.anio = p_anio es_actual, sum(r.venta_neta) vn, sum(r.kg) kg
    from ventas.resumen_cliente_mes r
    join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = p_version
    where vm.anio in (p_anio, p_anio - 1) and vm.mes between 1 and p_mes
      and r.anio in (p_anio, p_anio - 1) and r.mes between 1 and p_mes
      and (p_filtros->>'empresa' is null or r.empresa = p_filtros->>'empresa')
      and (p_filtros->>'canal'   is null or r.canal   = p_filtros->>'canal')
      and (p_filtros->>'ruta'    is null or r.ruta    = p_filtros->>'ruta')
      and (p_filtros->>'marca'   is null or r.marca   = p_filtros->>'marca')
    group by 1, r.empresa, r.cliente_codigo
  ),
  tot as (select es_actual, sum(vn) vn, sum(kg) kg, count(*) filter (where vn > 0) n from por_cliente group by es_actual),
  lado as (
    select x.es_actual, coalesce(t.vn, 0) vn, coalesce(t.kg, 0) kg, coalesce(t.n, 0) cl,
      (select coalesce(jsonb_agg(vm.mes order by vm.mes), '[]'::jsonb) from ventas.version_mes vm
       where vm.version = p_version and vm.anio = case when x.es_actual then p_anio else p_anio - 1 end and vm.mes between 1 and p_mes) meses
    from (values (true), (false)) x(es_actual)
    left join tot t using (es_actual)
  ),
  a as (select * from lado where es_actual), b as (select * from lado where not es_actual)
  select jsonb_build_object(
    'anio', p_anio, 'mes', p_mes,
    'venta_neta', a.vn, 'kg', a.kg, 'precio_kg', case when a.kg <> 0 then round(a.vn / a.kg, 2) end, 'clientes_con_compra', a.cl,
    'venta_neta_cmp', b.vn, 'kg_cmp', b.kg, 'precio_kg_cmp', case when b.kg <> 0 then round(b.vn / b.kg, 2) end, 'clientes_con_compra_cmp', b.cl,
    'meses', a.meses, 'meses_cmp', b.meses)
  from a, b);
end $$;

-- Estados de clientes (0015, S22). Solo cambia el CTE lin: agrupa el resumen por cliente al mismo grano que antes
-- agrupaba las líneas (cliente × mes, y ruta en P y C). max(ultima_venta) = max(fecha) de las líneas con venta > 0.
-- Sin enable_sort/enable_nestloop = off (0027): eran para agrupar el millón de líneas de hecho; aquí el plan bueno es
-- justamente el nested loop composición → índice del resumen. La ruta por hecho (_v1) conserva esos ajustes.
create or replace function interno._clientes_estado(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns table (
  empresa text, cliente_codigo text, ruta text, estado text, en_riesgo boolean,
  venta numeric, venta_cmp numeric, ultima_compra date
) language plpgsql stable set statement_timeout = '2min' set work_mem = '64MB' as $$
begin
  if p_filtros->>'art_codigo' is not null then
    return query select * from interno._clientes_estado_v1(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros);
    return;
  end if;
  return query execute $q$
  with lin as (
    select r.empresa, r.cliente_codigo, r.anio, r.mes,
           case when (r.anio = $2 and r.mes = $3) or (r.anio = $4 and r.mes = $5) then r.ruta end ruta,
           sum(r.venta_neta) vn, max(r.ultima_venta) ultima
    from ventas.resumen_cliente_mes r
    join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = $1
    where vm.anio * 100 + vm.mes <= greatest($2 * 100 + $3, $4 * 100 + $5)
      and r.anio * 100 + r.mes <= greatest($2 * 100 + $3, $4 * 100 + $5)
      and ($6->>'empresa' is null or r.empresa = $6->>'empresa')
      and ($6->>'canal'   is null or r.canal   = $6->>'canal')
      and ($6->>'ruta'    is null or r.ruta    = $6->>'ruta')
      and ($6->>'marca'   is null or r.marca   = $6->>'marca')
    group by 1, 2, 3, 4, 5
  ),
  ord as (
    select l.*, (l.anio = $2 and l.mes = $3) es_p, (l.anio = $4 and l.mes = $5) es_c,
           row_number() over (partition by l.empresa, l.cliente_codigo, l.anio, l.mes order by l.vn desc, l.ruta) rn
    from lin l
  ),
  cli as (
    select o.empresa, o.cliente_codigo,
      coalesce(sum(o.vn) filter (where o.es_p), 0) venta,
      coalesce(sum(o.vn) filter (where o.es_c), 0) venta_cmp,
      max(o.ruta) filter (where o.es_p and o.rn = 1) ruta_p,
      max(o.ruta) filter (where o.es_c and o.rn = 1) ruta_c,
      coalesce(bool_or(o.vn > 0) filter (where not o.es_p and not o.es_c and o.anio * 100 + o.mes < $2 * 100 + $3), false) compro_antes,
      max(o.ultima) filter (where not o.es_p and not o.es_c and o.vn > 0) ultima_otros,
      max(o.ultima) filter (where o.es_p) ultima_p,
      max(o.ultima) filter (where o.es_c) ultima_c
    from ord o group by 1, 2
  ),
  est as (
    select c.*, case
      when c.venta > 0 and c.venta_cmp > 0 then 'continua'
      when c.venta > 0 and c.compro_antes then 'recuperado'
      when c.venta > 0 then 'nuevo'
      else 'perdido' end estado
    from cli c where c.venta > 0 or c.venta_cmp > 0
  )
  select e.empresa, e.cliente_codigo, case when e.venta > 0 then e.ruta_p else e.ruta_c end, e.estado,
         e.estado = 'continua' and e.venta < e.venta_cmp * (1 - interno.umbral_riesgo_clientes()),
         e.venta, e.venta_cmp,
         -- Última compra: última línea con venta en un mes en que el cliente compró (S4), hasta el periodo más reciente.
         greatest(e.ultima_otros, case when e.venta > 0 then e.ultima_p end, case when e.venta_cmp > 0 then e.ultima_c end)
  from est e
  $q$ using p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros;
end $$;

-- 6. Permisos: las funciones nuevas de `interno` como las de 0006/0026 (lector_ventas y service_role; nadie más).
-- Las _v1 conservan los suyos (el renombre no los toca). Los envoltorios de `ventas` no cambian: mismo dueño
-- (lector_ventas), SECURITY DEFINER y statement_timeout de 0027/0028.
revoke execute on function
  interno.kpi_periodo(int, int, int, int, int, jsonb),
  interno.variacion_por_dimension(int, text, int, int, int, int, jsonb),
  interno.top_contribuyentes(int, int, int, int, int, jsonb, int),
  interno.puente_precio_volumen_mezcla(int, int, int, int, int, jsonb, int),
  interno.acumulado_anio(int, int, int, jsonb),
  interno._clientes_estado(int, int, int, int, int, jsonb)
from public, anon, authenticated;
grant execute on function
  interno.kpi_periodo(int, int, int, int, int, jsonb),
  interno.variacion_por_dimension(int, text, int, int, int, int, jsonb),
  interno.top_contribuyentes(int, int, int, int, int, jsonb, int),
  interno.puente_precio_volumen_mezcla(int, int, int, int, int, jsonb, int),
  interno.acumulado_anio(int, int, int, jsonb),
  interno._clientes_estado(int, int, int, int, int, jsonb)
to lector_ventas, service_role;

notify pgrst, 'reload schema';
