-- G9: operación mensual.
-- 1. Homologación de canales desde la app (S2, S19). Quien gestiona cargas agrega, cambia o quita la equivalencia
--    "canal de origen → canal BIA". Cada cambio deja su fila en la bitácora (quién, cuándo, antes y después) en la
--    misma transacción y se vuelve a aplicar a las cargas validadas que todavía no se publicaron, para que sus
--    alertas se actualicen. Los meses publicados NUNCA cambian aquí: solo cambian subiendo y publicando de nuevo.
-- 2. Totales por canal de las cargas y de la versión vigente para las alertas de anomalías por canal (S20).
-- 3. Resumen ejecutivo: datos de cualquier versión publicada (no solo la vigente) y correos del equipo (S21).
-- Mismo patrón que 0011: RLS activo, sin acceso para anon/authenticated; los cambios van por funciones que solo
-- service_role ejecuta, después de que el servidor verifica que quien lo pide gestiona cargas (admin o aprobador).

-- Bitácora de la homologación ------------------------------------------------------------------------------------
-- Sin llave foránea a ventas.homologacion: las filas quedan aunque la equivalencia se elimine.
create table ventas.homologacion_cambio (
  id bigint generated always as identity primary key,
  dimension text not null default 'canal',
  valor_origen text not null,
  accion text not null check (accion in ('creada', 'editada', 'eliminada')),
  antes jsonb,
  despues jsonb,
  cargas_actualizadas jsonb not null default '[]',   -- [{carga_id, archivo, filas}] cargas sin publicar a las que se aplicó
  usuario_id uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);
create index on ventas.homologacion_cambio (creado_en desc);
create index on ventas.homologacion_cambio (dimension, valor_origen, creado_en desc);
alter table ventas.homologacion_cambio enable row level security;
revoke all on ventas.homologacion_cambio from public, anon, authenticated;
grant all on ventas.homologacion_cambio to service_role;
grant usage, select on sequence ventas.homologacion_cambio_id_seq to service_role;

create or replace function interno._foto_homologacion(h ventas.homologacion) returns jsonb language sql immutable as $$
  select case when h.valor_origen is null then null
    else jsonb_build_object('valor_homologado', h.valor_homologado, 'revisar', h.revisar) end
$$;

/**
 * Vuelve a aplicar la homologación de un canal de origen a las cargas validadas y sin publicar que lo traen.
 * Doble resguardo para no tocar datos publicados: estado 'validada' y ningún mes de la carga en una versión.
 * Bloquea cada carga (for update) como hace ventas.publicar: una publicación simultánea espera a que termine.
 */
create or replace function interno._reaplicar_homologacion_canal(p_origen text) returns jsonb
language plpgsql set search_path = '' set statement_timeout = '10min' as $$
declare
  destino text := (select valor_homologado from ventas.homologacion where dimension = 'canal' and valor_origen = p_origen);
  c record;
  n int;
  hechas jsonb := '[]'::jsonb;
begin
  for c in
    select ca.id, ca.nombre_archivo from ventas.carga ca
    where ca.estado = 'validada'
      and not exists (select 1 from ventas.version_mes vm where vm.carga_id = ca.id)
      and exists (select 1 from ventas.hecho h where h.carga_id = ca.id and h.canal_origen = p_origen)
    order by ca.creado_en
    for update of ca
  loop
    -- Revisión dentro del bloqueo: pudo publicarse mientras se esperaba.
    continue when (select estado from ventas.carga where id = c.id) <> 'validada';
    update ventas.hecho h set canal = coalesce(destino, h.canal_origen)
    where h.carga_id = c.id and h.canal_origen = p_origen and h.canal is distinct from coalesce(destino, h.canal_origen);
    get diagnostics n = row_count;
    -- Aunque no cambien filas, canales_sin_homologar sí puede cambiar (equivalencia idéntica creada o quitada).
    perform ventas._resumir_carga(c.id);
    if n > 0 then perform ventas._llenar_resumen(c.id); end if;
    hechas := hechas || jsonb_build_object('carga_id', c.id, 'archivo', c.nombre_archivo, 'filas', n);
  end loop;
  return hechas;
end $$;

/** Crea o cambia la equivalencia de un canal de origen. Guardarla desde la app la da por revisada (revisar = false). */
create or replace function ventas.guardar_homologacion_canal(p_origen text, p_homologado text, p_usuario uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  origen text := trim(coalesce(p_origen, ''));
  destino text := trim(coalesce(p_homologado, ''));
  antes ventas.homologacion;
  r ventas.homologacion;
  cargas jsonb;
begin
  if length(origen) > 100 then raise exception 'El canal de origen pasa de 100 caracteres.'; end if;
  if destino = '' or length(destino) > 60 then raise exception 'Indica el canal BIA (hasta 60 caracteres).'; end if;
  select * into antes from ventas.homologacion where dimension = 'canal' and valor_origen = origen for update;
  if found and antes.valor_homologado = destino and not antes.revisar then
    return jsonb_build_object('accion', 'sin_cambios', 'cargas_actualizadas', '[]'::jsonb);
  end if;
  insert into ventas.homologacion (dimension, valor_origen, valor_homologado, revisar) values ('canal', origen, destino, false)
  on conflict (dimension, valor_origen) do update set valor_homologado = excluded.valor_homologado, revisar = false
  returning * into r;
  cargas := interno._reaplicar_homologacion_canal(origen);
  insert into ventas.homologacion_cambio (dimension, valor_origen, accion, antes, despues, cargas_actualizadas, usuario_id)
  values ('canal', origen, case when antes.valor_origen is null then 'creada' else 'editada' end,
          interno._foto_homologacion(antes), interno._foto_homologacion(r), cargas, p_usuario);
  return jsonb_build_object('accion', case when antes.valor_origen is null then 'creada' else 'editada' end, 'cargas_actualizadas', cargas);
end $$;

/** Quita la equivalencia: el canal se muestra con su nombre de origen en las cargas sin publicar y en las próximas. */
create or replace function ventas.eliminar_homologacion_canal(p_origen text, p_usuario uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare antes ventas.homologacion; cargas jsonb;
begin
  delete from ventas.homologacion where dimension = 'canal' and valor_origen = p_origen returning * into antes;
  if not found then raise exception 'Esa homologación ya no existe; recarga la página.'; end if;
  cargas := interno._reaplicar_homologacion_canal(p_origen);
  insert into ventas.homologacion_cambio (dimension, valor_origen, accion, antes, cargas_actualizadas, usuario_id)
  values ('canal', p_origen, 'eliminada', interno._foto_homologacion(antes), cargas, p_usuario);
  return jsonb_build_object('accion', 'eliminada', 'cargas_actualizadas', cargas);
end $$;

/**
 * Canales de origen que se ven con su nombre de origen en las cargas sin publicar y en la versión vigente, con sus
 * ventas por carga y mes. `homologado_a` dice si ya tienen equivalencia (entonces solo faltan los meses publicados,
 * que cambian al volver a subirlos y publicarlos).
 */
create or replace function ventas.canales_pendientes_homologar() returns jsonb
language sql stable set search_path = '' set statement_timeout = '2min' as $$
  with vig as (select version from ventas.publicacion where retirada_en is null order by version desc limit 1),
  meses as (  -- meses de cargas sin publicar y meses de la versión vigente que, al resumirse, traían canales sin homologar
    select cm.carga_id, cm.anio, cm.mes, cm.canales_sin_homologar, c.estado, c.nombre_archivo, false en_vigente
    from ventas.carga_mes cm join ventas.carga c on c.id = cm.carga_id
    where c.estado = 'validada' and cardinality(cm.canales_sin_homologar) > 0
    union all
    select cm.carga_id, cm.anio, cm.mes, cm.canales_sin_homologar, c.estado, c.nombre_archivo, true
    from ventas.version_mes vm
    join ventas.carga_mes cm on cm.carga_id = vm.carga_id and cm.anio = vm.anio and cm.mes = vm.mes
    join ventas.carga c on c.id = cm.carga_id
    where vm.version = (select version from vig) and cardinality(cm.canales_sin_homologar) > 0
  ),
  g as (
    select m.carga_id, m.nombre_archivo, m.estado, m.en_vigente, h.anio, h.mes, h.canal_origen, h.canal,
           count(*) filas, sum(h.venta_neta) venta_neta, sum(h.kg) kg
    from meses m
    join ventas.hecho h on h.carga_id = m.carga_id and h.anio = m.anio and h.mes = m.mes and h.canal_origen = any(m.canales_sin_homologar)
    group by 1, 2, 3, 4, 5, 6, 7, 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'canal_origen', g.canal_origen, 'canal_actual', g.canal, 'homologado_a', ho.valor_homologado,
    'carga_id', g.carga_id, 'archivo', g.nombre_archivo, 'estado', g.estado, 'en_vigente', g.en_vigente,
    'anio', g.anio, 'mes', g.mes, 'filas', g.filas, 'venta_neta', g.venta_neta, 'kg', g.kg
  ) order by g.canal_origen, g.en_vigente, g.anio, g.mes), '[]'::jsonb)
  from g left join ventas.homologacion ho on ho.dimension = 'canal' and ho.valor_origen = g.canal_origen
  -- Sigue pendiente si no tiene equivalencia o si los datos guardados todavía no la reflejan.
  where ho.valor_origen is null or g.canal is distinct from ho.valor_homologado;
$$;

-- Alertas de anomalías por canal ----------------------------------------------------------------------------------
/**
 * Venta neta por canal homologado y mes: de cada carga pedida y de la versión vigente (de los 3 meses antes del
 * primer mes de las cargas hasta el último). Sale del resumen mensual, no de las filas.
 */
create or replace function ventas.totales_canal_mes(p_cargas uuid[]) returns jsonb
language sql stable set search_path = '' as $$
  with vig as (select version from ventas.publicacion where retirada_en is null order by version desc limit 1),
  rango as (
    select min(anio * 12 + mes - 1) - 3 desde, max(anio * 12 + mes - 1) hasta from ventas.carga_mes where carga_id = any(p_cargas)
  )
  select jsonb_build_object(
    'cargas', (select coalesce(jsonb_agg(jsonb_build_object('carga_id', carga_id, 'anio', anio, 'mes', mes, 'canal', canal, 'venta_neta', vn)), '[]'::jsonb)
               from (select r.carga_id, r.anio, r.mes, r.canal, sum(r.venta_neta) vn from ventas.resumen_mensual r
                     where r.carga_id = any(p_cargas) group by 1, 2, 3, 4) s),
    'vigente', (select coalesce(jsonb_agg(jsonb_build_object('anio', anio, 'mes', mes, 'canal', canal, 'venta_neta', vn)), '[]'::jsonb)
                from (select r.anio, r.mes, r.canal, sum(r.venta_neta) vn
                      from ventas.version_mes vm
                      join ventas.resumen_mensual r on r.carga_id = vm.carga_id and r.anio = vm.anio and r.mes = vm.mes
                      where vm.version = (select version from vig)
                        and vm.anio * 12 + vm.mes - 1 between (select desde from rango) and (select hasta from rango)
                      group by 1, 2, 3) s)
  );
$$;

-- Resumen ejecutivo ------------------------------------------------------------------------------------------------
/** Cabecera y periodos de una versión publicada (la vigente si p_version es nulo), aunque esté retirada. */
create or replace function ventas.version_publicada(p_version int default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return (
    select jsonb_build_object('version', p.version, 'fecha_corte', p.fecha_corte, 'conciliada_bi', p.conciliada_bi,
      'publicado_en', p.publicado_en, 'archivo', c.nombre_archivo, 'retirada_en', p.retirada_en,
      'vigente', p.version = (select max(version) from ventas.publicacion where retirada_en is null),
      'periodos', coalesce(p.metadatos->'periodos', '[]'::jsonb))
    from ventas.publicacion p join ventas.carga c on c.id = p.carga_id
    where p.version = coalesce(p_version, (select max(version) from ventas.publicacion where retirada_en is null))
  );
end $$;

/** Correos de las personas con perfil activo: destinatarios del resumen al publicar. */
create or replace function ventas.correos_equipo() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u.email order by u.email), '{}')
  from public.perfil p join auth.users u on u.id = p.user_id
  where p.activo and u.email is not null and u.email <> '';
$$;

-- Permisos ---------------------------------------------------------------------------------------------------------
revoke execute on function
  interno._foto_homologacion(ventas.homologacion), interno._reaplicar_homologacion_canal(text),
  ventas.guardar_homologacion_canal(text, text, uuid), ventas.eliminar_homologacion_canal(text, uuid),
  ventas.canales_pendientes_homologar(), ventas.totales_canal_mes(uuid[]), ventas.correos_equipo(),
  ventas.version_publicada(int)
from public, anon, authenticated;
grant execute on function
  interno._foto_homologacion(ventas.homologacion), interno._reaplicar_homologacion_canal(text),
  ventas.guardar_homologacion_canal(text, text, uuid), ventas.eliminar_homologacion_canal(text, uuid),
  ventas.canales_pendientes_homologar(), ventas.totales_canal_mes(uuid[]), ventas.correos_equipo(),
  ventas.version_publicada(int)
to service_role;
-- El resumen lo ve cualquiera con acceso (la función exige sesión con 2FA y perfil activo).
grant execute on function ventas.version_publicada(int) to authenticated;

-- Equivalencias guardadas mientras una carga se procesaba: la ingesta leyó las de antes, así que al cerrar la carga
-- se aplican las de ahora a sus filas (si no, carga_mes diría "homologado" con hecho.canal todavía en el origen).
create or replace function ventas.cerrar_carga(p_carga uuid) returns void
language plpgsql set statement_timeout = '10min' as $$
begin
  update ventas.hecho h set canal = ho.valor_homologado
  from ventas.homologacion ho
  where h.carga_id = p_carga and ho.dimension = 'canal' and ho.valor_origen = h.canal_origen
    and h.canal is distinct from ho.valor_homologado;
  perform ventas._resumir_carga(p_carga);
  perform ventas._llenar_resumen(p_carga);
  update ventas.carga c set estado = 'validada', error = null, procesado_en = now(),
    periodo_desde = (select min(make_date(anio, mes, 1)) from ventas.carga_mes where carga_id = p_carga),
    periodo_hasta = (select max(ultimo_dia) from ventas.carga_mes where carga_id = p_carga)
  where c.id = p_carga;
end $$;

notify pgrst, 'reload schema';
