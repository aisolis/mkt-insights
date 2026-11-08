-- G9: clientes por estado, solo Plus (S12, S16, S22).
-- Primer lugar con detalle por cliente (código y nombre). La base lo exige: los envoltorios de `ventas` llaman
-- interno.exigir_acceso('plus'), así que una sesión Estándar recibe "acceso denegado" aunque llame la API directo.
-- Nada de esto llega al asistente de IA (S15): no hay herramienta ni contexto que use estas funciones.
--
-- Estados de un cliente (clave empresa + código, S4) para un periodo P contra su periodo de comparación C,
-- con los filtros del dashboard. "Compró en un mes" = venta neta sumada del mes > 0 (S4):
--   * activos     compraron en P (= clientes_con_compra de kpi_periodo). Se reparten sin traslape en:
--       - nuevos       su primera compra dentro de la versión (con los filtros) es en P
--       - recuperados  compraron en P, no en C, pero sí en algún mes anterior a P
--       - continúan    compraron en P y en C
--   * perdidos    compraron en C y no en P
--   * en riesgo   parte de "continúan": la venta de P cayó más del umbral contra C (interno.umbral_riesgo_clientes)
-- La historia empieza con el primer mes de la versión (enero 2025): "nuevo" es nuevo desde ahí.

-- Umbral de "en riesgo": compró menos de la mitad que en el periodo de comparación (caída > 50 %).
create or replace function interno.umbral_riesgo_clientes() returns numeric
language sql immutable as $$ select 0.50::numeric $$;

-- Un registro por cliente con compra en P o en C: estado, ruta principal, ventas de ambos periodos y última compra.
-- Ruta principal = la de mayor venta del cliente en P (en C para los perdidos), así la suma por ruta da el total.
create or replace function interno._clientes_estado(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns table (
  empresa text, cliente_codigo text, ruta text, estado text, en_riesgo boolean,
  venta numeric, venta_cmp numeric, ultima_compra date
) language plpgsql stable set statement_timeout = '2min' set work_mem = '64MB' as $$
begin
  -- EXECUTE planea con los valores reales: con parámetros genéricos el planificador cree que los filtros dejan
  -- una fila y elige un nested loop (17 s en vez de 3 s).
  return query execute $q$
  -- Una sola pasada por el hecho (≈ 1 M de líneas, 2–3 s): venta por cliente y mes desde el inicio de la versión;
  -- en P y en C además por ruta (en los otros meses la ruta queda en null y la fila es el mes completo).
  with lin as (
    select h.empresa, h.cliente_codigo, h.anio, h.mes,
           case when (h.anio = $2 and h.mes = $3) or (h.anio = $4 and h.mes = $5) then h.ruta end ruta,
           sum(h.venta_neta) vn, max(h.fecha) filter (where h.venta_neta > 0) ultima
    from ventas.hecho h
    join ventas.version_mes vm on vm.carga_id = h.carga_id and vm.anio = h.anio and vm.mes = h.mes and vm.version = $1
    where h.anio * 100 + h.mes <= greatest($2 * 100 + $3, $4 * 100 + $5)
      and ventas._where_filtros(h, $6)
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

-- Conteos y ventas por estado, y el reparto por ruta principal. Solo agregados, pero va con el resto (Plus).
create or replace function interno.clientes_resumen(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language sql stable as $$
  with e as (select * from interno._clientes_estado(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros)),
  grupo(nombre, incluye) as (values ('activos', array['nuevo', 'recuperado', 'continua']), ('nuevos', array['nuevo']),
    ('recuperados', array['recuperado']), ('continuan', array['continua']), ('perdidos', array['perdido']), ('en_riesgo', null::text[])),
  estados as (
    select jsonb_object_agg(g.nombre, jsonb_build_object(
      'clientes', (select count(*) from e where e.estado = any(g.incluye) or (g.incluye is null and e.en_riesgo)),
      'venta', (select coalesce(sum(e.venta), 0) from e where e.estado = any(g.incluye) or (g.incluye is null and e.en_riesgo)),
      'venta_cmp', (select coalesce(sum(e.venta_cmp), 0) from e where e.estado = any(g.incluye) or (g.incluye is null and e.en_riesgo))
    )) j from grupo g
  ),
  rutas as (
    select e.ruta,
      count(*) filter (where e.estado <> 'perdido') activos,
      count(*) filter (where e.estado = 'nuevo') nuevos,
      count(*) filter (where e.estado = 'recuperado') recuperados,
      count(*) filter (where e.estado = 'continua') continuan,
      count(*) filter (where e.estado = 'perdido') perdidos,
      count(*) filter (where e.en_riesgo) en_riesgo,
      coalesce(sum(e.venta) filter (where e.estado <> 'perdido'), 0) venta_activos,
      coalesce(sum(e.venta_cmp) filter (where e.estado = 'perdido'), 0) venta_perdidos_cmp
    from e group by e.ruta
  )
  select jsonb_build_object(
    'umbral_riesgo', interno.umbral_riesgo_clientes(),
    'estados', (select j from estados),
    'por_ruta', coalesce((select jsonb_agg(to_jsonb(r) order by r.activos + r.perdidos desc, r.ruta) from rutas r), '[]'::jsonb));
$$;

-- Lista de clientes de un estado, con nombre, ruta principal, ventas de ambos periodos y última compra.
-- Orden: perdidos por lo que compraban en C; en riesgo por la caída; el resto por la venta de P.
create or replace function interno.clientes_lista(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}',
  p_estado text default 'activos', p_limite int default 50, p_desplazamiento int default 0
) returns jsonb language plpgsql stable set statement_timeout = '2min' as $$
declare r jsonb;
begin
  if p_estado not in ('activos', 'nuevos', 'recuperados', 'continuan', 'perdidos', 'en_riesgo') then
    raise exception 'estado no permitido: %', p_estado;
  end if;
  with e as (
    select * from interno._clientes_estado(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros) x
    where case p_estado
      when 'activos' then x.estado <> 'perdido'
      when 'nuevos' then x.estado = 'nuevo'
      when 'recuperados' then x.estado = 'recuperado'
      when 'continuan' then x.estado = 'continua'
      when 'perdidos' then x.estado = 'perdido'
      else x.en_riesgo end
  ),
  pagina as (
    select e.*, row_number() over (order by
      case when p_estado = 'perdidos' then -e.venta_cmp when p_estado = 'en_riesgo' then e.venta - e.venta_cmp else -e.venta end,
      e.empresa, e.cliente_codigo) orden
    from e
    order by orden
    limit least(greatest(p_limite, 1), 50000) offset greatest(p_desplazamiento, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from e),
    'filas', coalesce(jsonb_agg(jsonb_build_object(
      'empresa', p.empresa, 'cliente_codigo', p.cliente_codigo, 'cliente_nombre', n.cliente_nombre, 'ruta', p.ruta,
      'estado', p.estado, 'en_riesgo', p.en_riesgo, 'venta', p.venta, 'venta_cmp', p.venta_cmp,
      'variacion', p.venta - p.venta_cmp, 'ultima_compra', p.ultima_compra) order by p.orden), '[]'::jsonb))
  into r
  from pagina p
  -- Nombre más reciente del cliente en la versión (el cubo trae variantes de escritura para ~10 % de los códigos).
  left join lateral (
    select h.cliente_nombre from ventas.hecho h
    join ventas.version_mes vm on vm.carga_id = h.carga_id and vm.anio = h.anio and vm.mes = h.mes and vm.version = p_version
    where h.empresa = p.empresa and h.cliente_codigo = p.cliente_codigo
    order by h.fecha desc, h.id desc limit 1
  ) n on true;
  return r;
end $$;

-- Envoltorios con control de acceso: solo Plus (y service_role) ------------------------------------------------
create or replace function ventas.clientes_resumen(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso('plus');
  return interno.clientes_resumen(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros);
end $$;

create or replace function ventas.clientes_lista(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}',
  p_estado text default 'activos', p_limite int default 50, p_desplazamiento int default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso('plus');
  return interno.clientes_lista(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros, p_estado, p_limite, p_desplazamiento);
end $$;

-- Permisos: en `interno` nada para anon/authenticated; en `ventas` solo los envoltorios, para authenticated.
revoke execute on function
  interno.umbral_riesgo_clientes(), interno._clientes_estado(int, int, int, int, int, jsonb),
  interno.clientes_resumen(int, int, int, int, int, jsonb), interno.clientes_lista(int, int, int, int, int, jsonb, text, int, int)
from public, anon, authenticated;
grant execute on function
  interno.umbral_riesgo_clientes(), interno._clientes_estado(int, int, int, int, int, jsonb),
  interno.clientes_resumen(int, int, int, int, int, jsonb), interno.clientes_lista(int, int, int, int, int, jsonb, text, int, int)
to service_role;
revoke execute on function
  ventas.clientes_resumen(int, int, int, int, int, jsonb), ventas.clientes_lista(int, int, int, int, int, jsonb, text, int, int)
from public, anon;
grant execute on function
  ventas.clientes_resumen(int, int, int, int, int, jsonb), ventas.clientes_lista(int, int, int, int, int, jsonb, text, int, int)
to authenticated, service_role;

notify pgrst, 'reload schema';
