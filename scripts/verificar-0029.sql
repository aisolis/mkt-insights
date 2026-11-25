-- Verificación de 0029_resumenes_lectura.sql: SOLO en una copia de la base, después de aplicar la migración.
-- No está en supabase/migrations a propósito (la CLI no debe correrlo). No escribe en tablas reales: crea tablas y
-- funciones temporales (pg_temp) que desaparecen al cerrar la sesión. La sección 4 (ámbito) es opcional y va en una
-- transacción que termina en rollback.
--
-- Uso (una sola sesión, porque los resultados quedan en una tabla temporal):
--   psql "<cadena de conexión de la COPIA, rol postgres>" -v ON_ERROR_STOP=1 -f scripts/verificar-0029.sql
-- (El editor SQL de Supabase puede repartir las sentencias en conexiones distintas y perder las tablas temporales.)
--
-- Qué revisa:
--   1. Tamaño de cada grano (cuánto se reduce contra hecho, y cuánto se reduciría sin marca).
--   2. Que los resúmenes cuadren con hecho, mes por mes y fila por fila de su grano, en todo mes de alguna versión.
--   3. Paridad: cada lectura nueva contra su implementación anterior (interno.<nombre>_v1) para varios periodos ×
--      comparaciones × filtros, con tiempos. Esperado: todo igual (igual_texto); en variacion_por_dimension y
--      top_contribuyentes se acepta igual_conjunto (0029 desempata el orden entre valores con la misma variación).
--   4. (Opcional) Lo mismo con el ámbito de una persona (rol lector_ventas + sesión simulada).
--   5. Sugerencias de EXPLAIN ANALYZE.
--
-- Corrido como postgres (dueño de las tablas) las políticas RLS no aplican: las secciones 1–3 ven toda la venta.

set statement_timeout = 0;
-- Cuántos periodos (los últimos de la versión vigente) y cuántas rutas/marcas entran en la paridad. Bajar si tarda.
select set_config('verif.periodos', '3', false), set_config('verif.rutas', '5', false), set_config('verif.marcas', '8', false);

-- 1. Tamaños -----------------------------------------------------------------------------------------------------
select 'hecho' tabla, count(*) filas from ventas.hecho
union all select 'resumen_mensual', count(*) from ventas.resumen_mensual
union all select 'resumen_cliente_mes', count(*) from ventas.resumen_cliente_mes
union all select 'grano cliente SIN marca (hipotético)', count(*) from (
  select distinct carga_id, anio, mes, empresa, cliente_codigo, canal, ruta from ventas.resumen_cliente_mes) s;

-- Por mes de la versión vigente: lo que lee cada consulta de un mes.
with v as (select max(version) v from ventas.publicacion where retirada_en is null)
select vm.anio, vm.mes,
  (select count(*) from ventas.hecho h where h.carga_id = vm.carga_id and h.anio = vm.anio and h.mes = vm.mes) hecho,
  (select count(*) from ventas.resumen_mensual r where r.carga_id = vm.carga_id and r.anio = vm.anio and r.mes = vm.mes) resumen_mensual,
  (select count(*) from ventas.resumen_cliente_mes r where r.carga_id = vm.carga_id and r.anio = vm.anio and r.mes = vm.mes) resumen_cliente_mes
from ventas.version_mes vm join v on vm.version = v.v
order by vm.anio, vm.mes;

-- 2. Consistencia resúmenes ↔ hecho ----------------------------------------------------------------------------------
-- 2a. Totales por (carga, mes) de cualquier versión. Esperado: 0 filas.
with m as (select distinct carga_id, anio, mes from ventas.version_mes),
th as (select h.carga_id, h.anio, h.mes, count(*) filas, sum(h.venta_neta) vn, sum(h.kg) kg
       from ventas.hecho h join m using (carga_id, anio, mes) group by 1, 2, 3),
tr as (select r.carga_id, r.anio, r.mes, sum(r.filas) filas, sum(r.venta_neta) vn, sum(r.kg) kg, count(*) filter (where r.art_descrip is null) sin_descrip
       from ventas.resumen_mensual r join m using (carga_id, anio, mes) group by 1, 2, 3),
tc as (select r.carga_id, r.anio, r.mes, sum(r.filas) filas, sum(r.venta_neta) vn, sum(r.kg) kg
       from ventas.resumen_cliente_mes r join m using (carga_id, anio, mes) group by 1, 2, 3)
select m.carga_id, m.anio, m.mes, th.filas hecho_filas, tr.filas rm_filas, tc.filas rc_filas,
       th.vn hecho_vn, tr.vn rm_vn, tc.vn rc_vn, th.kg hecho_kg, tr.kg rm_kg, tc.kg rc_kg, tr.sin_descrip
from m left join th using (carga_id, anio, mes) left join tr using (carga_id, anio, mes) left join tc using (carga_id, anio, mes)
where th.filas is distinct from tr.filas or th.filas is distinct from tc.filas
   or th.vn is distinct from tr.vn or th.vn is distinct from tc.vn
   or th.kg is distinct from tr.kg or th.kg is distinct from tc.kg
   or coalesce(tr.sin_descrip, 0) > 0
order by 1, 2, 3;
-- Si sale alguna: `select ventas._llenar_resumen('<carga_id>');` la rehace desde hecho (cambia la huella de
-- aprobación solo si el resumen estaba mal).

-- 2b. Fila por fila del grano, meses de la versión vigente. Esperado: 0 y 0 en las cuatro columnas.
with v as (select max(version) v from ventas.publicacion where retirada_en is null),
m as (select vm.carga_id, vm.anio, vm.mes from ventas.version_mes vm join v on vm.version = v.v),
hc as (select h.carga_id, h.anio, h.mes, h.empresa, h.cliente_codigo, h.canal, h.ruta, h.marca,
              count(*)::int filas, sum(h.venta_neta)::numeric(16,2) vn, sum(h.kg)::numeric(14,4) kg, max(h.fecha) filter (where h.venta_neta > 0) ultima
       from ventas.hecho h join m using (carga_id, anio, mes) group by 1, 2, 3, 4, 5, 6, 7, 8),
rc as (select r.carga_id, r.anio, r.mes, r.empresa, r.cliente_codigo, r.canal, r.ruta, r.marca, r.filas, r.venta_neta, r.kg, r.ultima_venta
       from ventas.resumen_cliente_mes r join m using (carga_id, anio, mes)),
hm as (select h.carga_id, h.anio, h.mes, h.empresa, h.canal, h.ruta, h.marca, h.art_codigo,
              count(*)::int filas, sum(h.venta_neta)::numeric(16,2) vn, sum(h.kg)::numeric(14,4) kg, min(h.art_descrip) d
       from ventas.hecho h join m using (carga_id, anio, mes) group by 1, 2, 3, 4, 5, 6, 7, 8),
rm as (select r.carga_id, r.anio, r.mes, r.empresa, r.canal, r.ruta, r.marca, r.art_codigo, r.filas, r.venta_neta, r.kg, r.art_descrip
       from ventas.resumen_mensual r join m using (carga_id, anio, mes))
select
  (select count(*) from (select * from hc except all select * from rc) x) cliente_falta_en_resumen,
  (select count(*) from (select * from rc except all select * from hc) x) cliente_sobra_en_resumen,
  (select count(*) from (select * from hm except all select * from rm) x) mensual_falta_en_resumen,
  (select count(*) from (select * from rm except all select * from hm) x) mensual_sobra_en_resumen;

-- 3. Paridad nuevo contra _v1 -----------------------------------------------------------------------------------------
drop table if exists pg_temp.paridad_0029;
create temp table paridad_0029 (
  n serial primary key,
  funcion text not null,
  args text not null,
  igual boolean,           -- jsonb = jsonb (numérico: 1.50 = 1.5)
  igual_texto boolean,     -- mismo texto, incluidos decimales y orden
  igual_conjunto boolean,  -- mismo contenido aunque cambie el orden de un arreglo de primer nivel
  ms_nuevo numeric, ms_viejo numeric,
  nuevo jsonb, viejo jsonb -- solo cuando el texto difiere
);

-- Arreglo de primer nivel ordenado por su texto (para separar "cambió el orden de empates" de "cambió una cifra").
create or replace function pg_temp.conjunto(j jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(j) = 'array'
    then (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from jsonb_array_elements(j) x) else j end
$$;

-- Llama interno.<f>_v1(args) y interno.<f>(args) (args = lista SQL literal) y anota el resultado.
create or replace function pg_temp.comparar(p_funcion text, p_args text) returns void language plpgsql as $$
declare t0 timestamptz; t1 timestamptz; t2 timestamptz; n jsonb; v jsonb;
begin
  t0 := clock_timestamp();
  execute format('select interno.%I(%s)', p_funcion || '_v1', p_args) into v;
  t1 := clock_timestamp();
  execute format('select interno.%I(%s)', p_funcion, p_args) into n;
  t2 := clock_timestamp();
  insert into pg_temp.paridad_0029 (funcion, args, igual, igual_texto, igual_conjunto, ms_nuevo, ms_viejo, nuevo, viejo)
  values (p_funcion, p_args, n is not distinct from v, n::text is not distinct from v::text,
          pg_temp.conjunto(n) is not distinct from pg_temp.conjunto(v),
          round(extract(epoch from t2 - t1)::numeric * 1000, 1), round(extract(epoch from t1 - t0)::numeric * 1000, 1),
          case when n::text is distinct from v::text then n end, case when n::text is distinct from v::text then v end);
end $$;

-- _clientes_estado devuelve filas: se comparan como multiconjunto de filas en texto (decimales incluidos).
create or replace function pg_temp.comparar_clientes(p_args text) returns void language plpgsql as $$
declare t0 timestamptz; t1 timestamptz; t2 timestamptz; an text[]; av text[]; dif bigint;
begin
  t0 := clock_timestamp();
  execute format('select coalesce(array_agg(x::text order by x::text), ''{}'') from interno._clientes_estado_v1(%s) x', p_args) into av;
  t1 := clock_timestamp();
  execute format('select coalesce(array_agg(x::text order by x::text), ''{}'') from interno._clientes_estado(%s) x', p_args) into an;
  t2 := clock_timestamp();
  select count(*) into dif from (
    (select unnest(an) except all select unnest(av)) union all (select unnest(av) except all select unnest(an))) d;
  insert into pg_temp.paridad_0029 (funcion, args, igual, igual_texto, igual_conjunto, ms_nuevo, ms_viejo, nuevo, viejo)
  values ('_clientes_estado', p_args, dif = 0, an = av, dif = 0,
          round(extract(epoch from t2 - t1)::numeric * 1000, 1), round(extract(epoch from t1 - t0)::numeric * 1000, 1),
          case when dif > 0 then jsonb_build_object('filas', cardinality(an), 'filas_distintas', dif) end,
          case when dif > 0 then jsonb_build_object('filas', cardinality(av)) end);
end $$;

do $$
declare
  vv jsonb := interno.version_vigente();
  ver int := (vv->>'version')::int;
  meta jsonb := vv->'metadatos';
  filtros jsonb;
  f jsonb;
  fl text;   -- filtro como literal SQL
  per record;
  cmp record;
  base text;
  dim text;
  primero boolean := true;
begin
  if ver is null then raise exception 'no hay versión vigente'; end if;

  -- Filtros: sin filtro, valores que no existen, claves con null o desconocidas, cada canal, las rutas y marcas de
  -- más venta, cada empresa, dos productos (ruta por hecho) y combinaciones.
  filtros := jsonb_build_array('{}'::jsonb, 'null'::jsonb, '{"canal": "__no_existe__"}'::jsonb, '{"canal": null}'::jsonb, '{"zona": "x"}'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('canal', x)) from jsonb_array_elements_text(meta->'canal') x), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('ruta', ruta)) from (
         select r.ruta from ventas.resumen_mensual r
         join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = ver
         group by r.ruta order by sum(r.venta_neta) desc, r.ruta limit current_setting('verif.rutas')::int) s), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('marca', marca)) from (
         select r.marca from ventas.resumen_mensual r
         join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = ver
         group by r.marca order by sum(r.venta_neta) desc, r.marca limit current_setting('verif.marcas')::int) s), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('empresa', empresa)) from (
         select distinct r.empresa from ventas.resumen_mensual r
         join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = ver) s), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('art_codigo', x->>'codigo')) from (
         select x from jsonb_array_elements(meta->'producto') x limit 2) s), '[]'::jsonb)
    || jsonb_build_array(
         jsonb_build_object('canal', meta->'canal'->>0, 'marca', meta->'marca'->>0),
         jsonb_build_object('ruta', meta->'ruta'->>0, 'marca', meta->'marca'->>0),
         jsonb_build_object('empresa', (select min(r.empresa) from ventas.resumen_mensual r
                                        join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = ver),
                            'canal', meta->'canal'->>0),
         jsonb_build_object('canal', meta->'canal'->>0, 'art_codigo', meta->'producto'->0->>'codigo'));

  for per in
    select (p->>'anio')::int anio, (p->>'mes')::int mes
    from jsonb_array_elements(meta->'periodos') with ordinality e(p, i)
    order by i desc limit current_setting('verif.periodos')::int
  loop
    for f in select x from jsonb_array_elements(filtros) x loop
      fl := case when jsonb_typeof(f) = 'null' then 'null::jsonb' else quote_literal(f::text) || '::jsonb' end;
      perform pg_temp.comparar('acumulado_anio', format('%s, %s, %s, %s', ver, per.anio, per.mes, fl));
    end loop;

    for cmp in
      select * from (values
        (case when per.mes = 1 then per.anio - 1 else per.anio end, case when per.mes = 1 then 12 else per.mes - 1 end),
        (per.anio - 1, per.mes)) c(anio, mes)
    loop
      for f in select x from jsonb_array_elements(filtros) x loop
        fl := case when jsonb_typeof(f) = 'null' then 'null::jsonb' else quote_literal(f::text) || '::jsonb' end;
        base := format('%s, %s, %s, %s, %s', per.anio, per.mes, cmp.anio, cmp.mes, fl);
        perform pg_temp.comparar('kpi_periodo', format('%s, %s', ver, base));
        foreach dim in array array['canal', 'ruta', 'marca', 'art_codigo', 'empresa', 'zona'] loop
          perform pg_temp.comparar('variacion_por_dimension', format('%s, %L, %s', ver, dim, base));
        end loop;
        perform pg_temp.comparar('top_contribuyentes', format('%s, %s, 10', ver, base));
        perform pg_temp.comparar('top_contribuyentes', format('%s, %s, 5000', ver, base));
        perform pg_temp.comparar('puente_precio_volumen_mezcla', format('%s, %s, 5', ver, base));
        perform pg_temp.comparar('puente_precio_volumen_mezcla', format('%s, %s, 50', ver, base));
      end loop;

      -- Clientes: cada llamada _v1 recorre la historia de hecho (3–7 s), así que solo el último periodo y pocos filtros.
      if primero then
        foreach fl in array array[
          '''{}''::jsonb',
          quote_literal(jsonb_build_object('canal', meta->'canal'->>0)::text) || '::jsonb',
          quote_literal(jsonb_build_object('marca', meta->'marca'->>0)::text) || '::jsonb',
          quote_literal(jsonb_build_object('ruta', meta->'ruta'->>0)::text) || '::jsonb',
          quote_literal(jsonb_build_object('art_codigo', meta->'producto'->0->>'codigo')::text) || '::jsonb'
        ] loop
          perform pg_temp.comparar_clientes(format('%s, %s, %s, %s, %s, %s', ver, per.anio, per.mes, cmp.anio, cmp.mes, fl));
        end loop;
      end if;
    end loop;
    primero := false;
  end loop;
end $$;

-- Resultado: por función, cuántas llamadas, cuántas distintas y tiempo promedio de base (ms).
select funcion, count(*) llamadas,
  count(*) filter (where not igual_texto) distintas_texto,
  count(*) filter (where not igual) distintas_valor,
  count(*) filter (where not igual_conjunto) distintas_conjunto,
  round(avg(ms_viejo)) ms_viejo_prom, round(avg(ms_nuevo)) ms_nuevo_prom,
  round(max(ms_viejo)) ms_viejo_max, round(max(ms_nuevo)) ms_nuevo_max
from pg_temp.paridad_0029 group by funcion order by funcion;

-- Detalle de lo que no cuadra (vacío = paridad exacta). Para variacion/top, igual_conjunto = true es aceptable.
select n, funcion, args, igual, igual_texto, igual_conjunto, nuevo, viejo
from pg_temp.paridad_0029 where not igual_texto order by n limit 50;

-- 4. (Opcional) Ámbito por persona ------------------------------------------------------------------------------------
-- Corre las lecturas como lector_ventas con la sesión simulada de una persona que tiene ámbito: las tablas nuevas
-- deben recortar igual que hecho. Elegir el usuario con:
--   select user_id, alcance from public.perfil where alcance is not null and activo;
-- y reemplazar 00000000-0000-0000-0000-000000000000. Si nadie tiene ámbito en la copia, se puede dar uno dentro de la
-- transacción (se deshace con el rollback): descomentar el update.
begin;
-- update public.perfil set alcance = jsonb_build_object('canal', jsonb_build_array((select (interno.version_vigente()->'metadatos'->'canal'->>0))))
--   where user_id = '00000000-0000-0000-0000-000000000000';
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000000", "role": "authenticated"}', true);
set local role lector_ventas;
with v as (select interno.version_vigente() vv),
p as (select (vv->>'version')::int ver, (vv->'metadatos'->'periodos'->-1->>'anio')::int a, (vv->'metadatos'->'periodos'->-1->>'mes')::int m from v),
q as (select ver, a, m, case when m = 1 then a - 1 else a end ac, case when m = 1 then 12 else m - 1 end mc from p)
select interno.alcance_sesion() alcance,
  interno.kpi_periodo(ver, a, m, ac, mc, '{}') = interno.kpi_periodo_v1(ver, a, m, ac, mc, '{}') kpi,
  interno.variacion_por_dimension(ver, 'ruta', a, m, ac, mc, '{}') = interno.variacion_por_dimension_v1(ver, 'ruta', a, m, ac, mc, '{}') variacion_ruta,
  interno.puente_precio_volumen_mezcla(ver, a, m, ac, mc, '{}', 5) = interno.puente_precio_volumen_mezcla_v1(ver, a, m, ac, mc, '{}', 5) puente,
  interno.acumulado_anio(ver, a, m, '{}') = interno.acumulado_anio_v1(ver, a, m, '{}') acumulado,
  (select count(*) from interno._clientes_estado(ver, a, m, ac, mc, '{}')) = (select count(*) from interno._clientes_estado_v1(ver, a, m, ac, mc, '{}')) clientes_mismo_total,
  (interno.kpi_periodo(ver, a, m, ac, mc, '{}')->>'venta_neta') venta_en_ambito
from q;
rollback;

-- 5. EXPLAIN ANALYZE ----------------------------------------------------------------------------------------------------
-- Las funciones se ven como una caja en EXPLAIN; el tiempo total ya sale en la sección 3 (ms_nuevo / ms_viejo). Para
-- ver el plan de adentro, si el rol puede cargar auto_explain en la copia:
--   load 'auto_explain'; set auto_explain.log_min_duration = 0; set auto_explain.log_nested_statements = on;
--   set auto_explain.log_analyze = on; set auto_explain.log_buffers = on;
--   select interno.kpi_periodo(<v>, <a>, <m>, <a_cmp>, <m_cmp>, '{}');   -- el plan queda en el log de Postgres
-- O la consulta base directo, con los valores puestos (sin ámbito: corre como postgres). Qué buscar:
--   * Nested Loop: Index Scan de version_mes_pkey (2 filas) → Index Scan de resumen_cliente_mes_pkey con
--     Index Cond (carga_id, anio, mes). Ningún Seq Scan sobre resumen_cliente_mes ni sobre hecho.
--   * Buffers: shared hit/read del orden de las filas de esos dos meses (sección 1), no de la tabla entera.
-- explain (analyze, buffers)
-- select r.empresa, r.cliente_codigo, sum(r.venta_neta)
-- from ventas.resumen_cliente_mes r
-- join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = <v>
-- where ((vm.anio = <a> and vm.mes = <m>) or (vm.anio = <a_cmp> and vm.mes = <m_cmp>))
--   and ((r.anio = <a> and r.mes = <m>) or (r.anio = <a_cmp> and r.mes = <m_cmp>))
-- group by 1, 2;
-- Igual para el acumulado (vm.anio in (<a>, <a> - 1) and vm.mes between 1 and <m>) y para clientes
-- (vm.anio * 100 + vm.mes <= <a> * 100 + <m>): esperado Nested Loop + Index Scan, HashAggregate en memoria
-- (sin "Sort Method: external merge" ni "Disk:" en el plan).
-- Para resumen_mensual (variacion, top, puente): mismo patrón con resumen_mensual_pkey.
