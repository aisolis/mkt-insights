-- Único punto de cálculo. Dashboard, asistente y exportación llaman estas funciones.
-- p_filtros: jsonb con claves opcionales empresa, canal, ruta, marca, art_codigo.

create or replace function ventas._where_filtros(h ventas.hecho, f jsonb) returns boolean
language sql immutable as $$
  select (f->>'empresa'    is null or h.empresa    = f->>'empresa')
     and (f->>'canal'      is null or h.canal      = f->>'canal')
     and (f->>'ruta'       is null or h.ruta       = f->>'ruta')
     and (f->>'marca'      is null or h.marca      = f->>'marca')
     and (f->>'art_codigo' is null or h.art_codigo = f->>'art_codigo')
$$;

create or replace function ventas.kpi_periodo(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language sql stable security invoker as $$
  with base as (
    select h.* from ventas.hecho h
    join ventas.publicacion p on p.carga_id = h.carga_id and p.version = p_version
    where ventas._where_filtros(h, p_filtros)
  ),
  a as (select coalesce(sum(venta_neta),0) vn, coalesce(sum(kg),0) kg,
               count(distinct (empresa, cliente_codigo)) filter (where venta_neta > 0) cl
        from base where anio = p_anio and mes = p_mes),
  c as (select coalesce(sum(venta_neta),0) vn, coalesce(sum(kg),0) kg,
               count(distinct (empresa, cliente_codigo)) filter (where venta_neta > 0) cl
        from base where anio = p_anio_cmp and mes = p_mes_cmp)
  select jsonb_build_object(
    'venta_neta', a.vn, 'kg', a.kg, 'precio_kg', case when a.kg <> 0 then round(a.vn / a.kg, 2) end, 'clientes_con_compra', a.cl,
    'venta_neta_cmp', c.vn, 'kg_cmp', c.kg, 'precio_kg_cmp', case when c.kg <> 0 then round(c.vn / c.kg, 2) end, 'clientes_con_compra_cmp', c.cl)
  from a, c;
$$;

create or replace function ventas.variacion_por_dimension(
  p_version int, p_dimension text, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language plpgsql stable security invoker as $$
declare r jsonb;
begin
  if p_dimension not in ('canal','ruta','zona','sucursal','marca','categoria','art_codigo','empresa') then
    raise exception 'dimension no permitida: %', p_dimension;
  end if;
  execute format($q$
    with base as (
      select h.* from ventas.hecho h
      join ventas.publicacion p on p.carga_id = h.carga_id and p.version = $1
      where ventas._where_filtros(h, $6)
        and ((anio = $2 and mes = $3) or (anio = $4 and mes = $5))
    ), g as (
      select %I valor,
        coalesce(sum(venta_neta) filter (where anio = $2 and mes = $3), 0) actual,
        coalesce(sum(venta_neta) filter (where anio = $4 and mes = $5), 0) anterior
      from base group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object('valor', valor, 'actual', actual, 'anterior', anterior, 'variacion', actual - anterior)
                              order by actual - anterior), '[]'::jsonb) from g
  $q$, p_dimension)
  into r using p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros;
  return r;
end $$;

create or replace function ventas.serie_mensual(p_version int, p_anio int, p_filtros jsonb default '{}')
returns jsonb language sql stable security invoker as $$
  select coalesce(jsonb_agg(jsonb_build_object('anio', anio, 'mes', mes, 'venta_neta', vn, 'kg', kg) order by mes), '[]'::jsonb)
  from (
    select h.anio, h.mes, sum(h.venta_neta) vn, sum(h.kg) kg
    from ventas.hecho h join ventas.publicacion p on p.carga_id = h.carga_id and p.version = p_version
    where h.anio = p_anio and ventas._where_filtros(h, p_filtros)
    group by 1,2
  ) s;
$$;

-- Totales de control para paridad con analisis/totales_*.csv (uso interno, service_role)
create or replace function ventas.control_mensual(p_carga uuid)
returns table (mes text, filas bigint, venta_neta numeric, kg numeric)
language sql stable as $$
  select to_char(fecha, 'YYYY-MM'), count(*), sum(venta_neta), sum(kg)
  from ventas.hecho where carga_id = p_carga group by 1 order by 1;
$$;
