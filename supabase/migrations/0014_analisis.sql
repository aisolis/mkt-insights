-- G9: análisis comercial. Tres lecturas nuevas con el mismo patrón que 0006/0008: el cálculo vive en `interno`
-- (unido a la composición de la versión, ventas.version_mes) y en `ventas` queda un envoltorio SECURITY DEFINER que
-- exige sesión con 2FA y perfil activo. Solo agregados: ninguna devuelve cliente ni subgrupo (S10, S12).
--   * puente_precio_volumen_mezcla: la variación de venta neta entre dos meses en volumen, precio y mezcla (S23).
--   * acumulado_anio: enero..mes elegido contra el mismo tramo del año anterior (S24).
--   * rutas_atipicas: rutas cuya variación del mes se sale de su propia historia reciente (S25).

-- Puente precio–volumen–mezcla (S23) -----------------------------------------------------------------------------
-- Por producto (art_codigo), volumen en kg y precio = venta neta / kg (el descuento ya está restado, así que más
-- descuento se ve como efecto precio negativo). Sobre los productos COMPARABLES (kg neto > 0 en ambos meses):
--   P0_i = V0_i / Q0_i,  P̄0 = V0c / Q0c  (precio promedio del mes comparado)
--   volumen = (Q1c − Q0c) × P̄0                       cuánto habría cambiado la venta solo por vender más o menos kg
--   mezcla  = Σ Q1_i × P0_i − Q1c × P̄0              cambio de peso entre productos caros y baratos
--   precio  = Σ Q1_i × (P1_i − P0_i) = V1c − Σ Q1_i × P0_i
-- volumen + mezcla + precio = V1c − V0c. Los demás productos van aparte, con su variación completa:
--   nuevos (kg neto ≤ 0 en el comparado y > 0 en el actual), descontinuados (al revés) y sin volumen (≤ 0 en ambos:
--   notas y ajustes sin kg). Para cuadrar al centavo, volumen y (volumen + mezcla) se redondean a 2 decimales y
--   precio y mezcla salen por diferencia: la suma de todos los efectos es exactamente la variación total.
-- El detalle por producto (efectos individuales, redondeados cada uno) es informativo: no se re-suma.
create or replace function interno.puente_precio_volumen_mezcla(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}', p_limite int default 5
) returns jsonb language plpgsql stable set plan_cache_mode = force_custom_plan as $$
begin
  return (
  with g as (
    select h.art_codigo, min(h.art_descrip) descripcion,
      coalesce(sum(h.venta_neta) filter (where h.anio = p_anio and h.mes = p_mes), 0) v1,
      coalesce(sum(h.kg)         filter (where h.anio = p_anio and h.mes = p_mes), 0) q1,
      coalesce(sum(h.venta_neta) filter (where h.anio = p_anio_cmp and h.mes = p_mes_cmp), 0) v0,
      coalesce(sum(h.kg)         filter (where h.anio = p_anio_cmp and h.mes = p_mes_cmp), 0) q0
    from ventas.hecho h
    join ventas.version_mes vm on vm.carga_id = h.carga_id and vm.anio = h.anio and vm.mes = h.mes and vm.version = p_version
    where ((h.anio = p_anio and h.mes = p_mes) or (h.anio = p_anio_cmp and h.mes = p_mes_cmp))
      and ventas._where_filtros(h, p_filtros)
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

-- Acumulado del año (S24) ----------------------------------------------------------------------------------------
-- Enero..p_mes de p_anio contra enero..p_mes de p_anio − 1, con los meses que la versión tenga en cada tramo.
-- Clientes con compra igual que S4 pero sobre todo el tramo: venta neta SUMADA en el tramo > 0.
-- Las advertencias de meses parciales, faltantes o sin certificar las arma la app (src/lib/dashboard/analisis.ts).
create or replace function interno.acumulado_anio(p_version int, p_anio int, p_mes int, p_filtros jsonb default '{}')
returns jsonb language plpgsql stable set work_mem = '32MB' set plan_cache_mode = force_custom_plan as $$
begin
  -- plpgsql con plan a la medida de cada llamada: una función SQL se planifica sin los valores de los parámetros,
  -- estima 1 fila y ordena ~900 mil en disco (6 s contra ~1.5 s).
  -- Una sola pasada por hecho (hasta 18 meses): primero por cliente, luego los totales de cada tramo.
  return (
  with por_cliente as (
    select h.anio = p_anio es_actual, sum(h.venta_neta) vn, sum(h.kg) kg
    from ventas.hecho h
    join ventas.version_mes vm on vm.carga_id = h.carga_id and vm.anio = h.anio and vm.mes = h.mes and vm.version = p_version
    where h.anio in (p_anio, p_anio - 1) and h.mes between 1 and p_mes
      and ventas._where_filtros(h, p_filtros)
    group by 1, h.empresa, h.cliente_codigo
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

-- Rutas fuera de lo normal (S25) ---------------------------------------------------------------------------------
-- Para cada ruta: cambio del mes elegido contra el mes anterior (venta neta, con los filtros) comparado con sus
-- cambios de un mes a otro de los 12 meses anteriores. Regla robusta (puntaje z modificado, Iglewicz y Hoaglin):
--   puntaje = (cambio − mediana) / escala,  escala = máx(1.4826 × MAD, 5 puntos porcentuales)
-- donde MAD es la mediana de las distancias a la mediana. Fuera de lo normal: |puntaje| ≥ 3.5.
-- Se evalúan solo rutas con al menos 6 cambios en la historia, venta > 0 el mes anterior y un promedio mensual de
-- la historia ≥ 0.1 % del promedio mensual de todas las rutas (con los mismos filtros): así las rutas chicas, donde
-- un pedido mueve todo, no llenan la lista. Lee del resumen mensual (sin cliente).
create or replace function interno.rutas_atipicas(p_version int, p_anio int, p_mes int, p_filtros jsonb default '{}', p_limite int default 10)
returns jsonb language plpgsql stable set plan_cache_mode = force_custom_plan as $$
begin
  return (
  with meses as (
    select vm.anio, vm.mes, (p_anio * 12 + p_mes) - (vm.anio * 12 + vm.mes) atras
    from ventas.version_mes vm
    where vm.version = p_version and (vm.anio * 12 + vm.mes) between (p_anio * 12 + p_mes - 13) and (p_anio * 12 + p_mes)
  ),
  v as (
    select r.ruta, m.atras, sum(r.venta_neta) vn
    from ventas.resumen_mensual r
    join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = p_version
    join meses m on m.anio = r.anio and m.mes = r.mes
    where (p_filtros->>'empresa'    is null or r.empresa    = p_filtros->>'empresa')
      and (p_filtros->>'canal'      is null or r.canal      = p_filtros->>'canal')
      and (p_filtros->>'ruta'       is null or r.ruta       = p_filtros->>'ruta')
      and (p_filtros->>'marca'      is null or r.marca      = p_filtros->>'marca')
      and (p_filtros->>'art_codigo' is null or r.art_codigo = p_filtros->>'art_codigo')
    group by 1, 2
  ),
  -- Ruta × mes con cero donde la ruta no vendió (un mes sin venta también es historia).
  grid as (
    select ru.ruta, m.atras, coalesce(v.vn, 0) vn
    from (select distinct ruta from v) ru cross join meses m left join v on v.ruta = ru.ruta and v.atras = m.atras
  ),
  cambios as (
    select g.ruta, g.atras, g.vn, p.vn vn_prev, case when p.vn > 0 then g.vn / p.vn - 1 end cambio
    from grid g join grid p on p.ruta = g.ruta and p.atras = g.atras + 1
  ),
  hist as (
    select ruta, count(cambio) n, percentile_cont(0.5) within group (order by cambio) mediana, min(cambio) minimo, max(cambio) maximo
    from cambios where atras between 1 and 12 group by ruta
  ),
  mad as (
    select c.ruta, percentile_cont(0.5) within group (order by abs(c.cambio - h.mediana)) mad
    from cambios c join hist h using (ruta) where c.atras between 1 and 12 and c.cambio is not null group by c.ruta
  ),
  tam as (select ruta, avg(vn) promedio from grid where atras between 1 and 12 group by ruta),
  umbral as (select 0.001 * coalesce(sum(promedio), 0) u from tam),
  -- Canal principal de la ruta en los dos meses comparados (solo para mostrar).
  canal as (
    select distinct on (r.ruta) r.ruta, r.canal
    from ventas.resumen_mensual r
    join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = p_version
    join meses m on m.anio = r.anio and m.mes = r.mes and m.atras in (0, 1)
    where (p_filtros->>'empresa'    is null or r.empresa    = p_filtros->>'empresa')
      and (p_filtros->>'canal'      is null or r.canal      = p_filtros->>'canal')
      and (p_filtros->>'ruta'       is null or r.ruta       = p_filtros->>'ruta')
      and (p_filtros->>'marca'      is null or r.marca      = p_filtros->>'marca')
      and (p_filtros->>'art_codigo' is null or r.art_codigo = p_filtros->>'art_codigo')
    group by r.ruta, r.canal order by r.ruta, sum(r.venta_neta) desc, r.canal
  ),
  ev as (
    select a.ruta, a.vn actual, a.vn_prev anterior, a.cambio, h.n, h.mediana, h.minimo, h.maximo, t.promedio,
      greatest(1.4826 * coalesce(m.mad, 0), 0.05) escala,
      case
        when t.promedio < (select u from umbral) then 'pequena'
        when a.cambio is null or coalesce(h.n, 0) < 6 then 'sin_historia'
        else 'evaluada'
      end estado
    from cambios a
    join tam t using (ruta)
    left join hist h using (ruta)
    left join mad m using (ruta)
    where a.atras = 0
  ),
  pun as (select ev.*, (cambio - mediana) / escala puntaje from ev where estado = 'evaluada'),
  fuera as (select * from pun where abs(puntaje) >= 3.5)
  select jsonb_build_object(
    'hay_periodo', exists (select 1 from meses where atras = 0),
    'hay_anterior', exists (select 1 from meses where atras = 1),
    'rutas_evaluadas', (select count(*) from pun),
    'rutas_pequenas', (select count(*) from ev where estado = 'pequena'),
    'rutas_sin_historia', (select count(*) from ev where estado = 'sin_historia'),
    'rutas_fuera', (select count(*) from fuera),
    'umbral_promedio', (select round(u, 2) from umbral),
    'rutas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ruta', f.ruta, 'canal', coalesce(c.canal, ''), 'actual', f.actual, 'anterior', f.anterior, 'variacion', f.actual - f.anterior,
        'cambio', round(f.cambio::numeric, 4), 'mediana', round(f.mediana::numeric, 4), 'escala', round(f.escala::numeric, 4),
        'minimo', round(f.minimo::numeric, 4), 'maximo', round(f.maximo::numeric, 4), 'puntaje', round(f.puntaje::numeric, 1),
        'meses_historia', f.n, 'promedio_mensual', round(f.promedio, 2))
        order by abs(f.puntaje) desc, f.ruta)
      from (select * from fuera order by abs(puntaje) desc, ruta limit greatest(p_limite, 0)) f
      left join canal c using (ruta)), '[]'::jsonb)));
end $$;

-- Envoltorios con control de acceso ------------------------------------------------------------------------------
create or replace function ventas.puente_precio_volumen_mezcla(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}', p_limite int default 5
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return interno.puente_precio_volumen_mezcla(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros, p_limite);
end $$;

create or replace function ventas.acumulado_anio(p_version int, p_anio int, p_mes int, p_filtros jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return interno.acumulado_anio(p_version, p_anio, p_mes, p_filtros);
end $$;

create or replace function ventas.rutas_atipicas(p_version int, p_anio int, p_mes int, p_filtros jsonb default '{}', p_limite int default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return interno.rutas_atipicas(p_version, p_anio, p_mes, p_filtros, p_limite);
end $$;

-- Permisos: en `interno` solo service_role; en `ventas` los envoltorios para authenticated (exigen acceso adentro).
revoke execute on function
  interno.puente_precio_volumen_mezcla(int, int, int, int, int, jsonb, int), interno.acumulado_anio(int, int, int, jsonb),
  interno.rutas_atipicas(int, int, int, jsonb, int),
  ventas.puente_precio_volumen_mezcla(int, int, int, int, int, jsonb, int), ventas.acumulado_anio(int, int, int, jsonb),
  ventas.rutas_atipicas(int, int, int, jsonb, int)
from public, anon, authenticated;
grant execute on function
  interno.puente_precio_volumen_mezcla(int, int, int, int, int, jsonb, int), interno.acumulado_anio(int, int, int, jsonb),
  interno.rutas_atipicas(int, int, int, jsonb, int)
to service_role;
grant execute on function
  ventas.puente_precio_volumen_mezcla(int, int, int, int, int, jsonb, int), ventas.acumulado_anio(int, int, int, jsonb),
  ventas.rutas_atipicas(int, int, int, jsonb, int)
to authenticated, service_role;

notify pgrst, 'reload schema';
