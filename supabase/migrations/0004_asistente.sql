-- G4: herramienta extra del asistente. Descompone la venta del periodo en clientes, facturas y ticket
-- para separar "se vendió menos a cada uno" de "compraron menos veces" (S14).

create or replace function ventas.descomposicion(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language sql stable security invoker as $$
  with base as (
    select (h.anio = p_anio and h.mes = p_mes) es_actual, h.empresa, h.cliente_codigo, h.documento, h.venta_neta, h.kg
    from ventas.hecho h
    join ventas.publicacion p on p.carga_id = h.carga_id and p.version = p_version
    where ((h.anio = p_anio and h.mes = p_mes) or (h.anio = p_anio_cmp and h.mes = p_mes_cmp))
      and ventas._where_filtros(h, p_filtros)
  ),
  tot as (
    select es_actual, coalesce(sum(venta_neta), 0) vn, coalesce(sum(kg), 0) kg, count(*) lineas from base group by es_actual
  ),
  -- S4 y S14: cuentan los clientes y las facturas cuya venta neta sumada en el periodo es > 0 (sin devoluciones netas).
  cli as (
    select es_actual, count(*) n from (
      select es_actual from base group by es_actual, empresa, cliente_codigo having sum(venta_neta) > 0
    ) x group by es_actual
  ),
  fac as (
    select es_actual, count(*) n from (
      select es_actual from base group by es_actual, empresa, documento having sum(venta_neta) > 0
    ) x group by es_actual
  ),
  lado as (
    select e.es_actual,
      coalesce(t.vn, 0) vn, coalesce(t.kg, 0) kg, coalesce(t.lineas, 0) lineas,
      coalesce(c.n, 0) clientes, coalesce(f.n, 0) facturas
    from (values (true), (false)) e(es_actual)
    left join tot t using (es_actual) left join cli c using (es_actual) left join fac f using (es_actual)
  )
  select jsonb_object_agg(case when es_actual then 'actual' else 'anterior' end, jsonb_build_object(
    'venta_neta', vn, 'kg', kg, 'lineas', lineas, 'clientes', clientes, 'facturas', facturas,
    'facturas_por_cliente', case when clientes > 0 then round(facturas::numeric / clientes, 2) end,
    'ticket_factura', case when facturas > 0 then round(vn / facturas, 2) end,
    'venta_por_cliente', case when clientes > 0 then round(vn / clientes, 2) end))
  from lado;
$$;
