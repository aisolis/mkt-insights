-- Presupuesto de IA por persona y solicitudes de ampliación.
--
-- Además del tope mensual de toda la app (0017), cada persona tiene un presupuesto mensual de IA en dólares:
-- * General: un monto para todos (config_asistente.presupuesto_usuario_usd; null = sin límite por persona).
-- * Propio: un admin puede fijarle a alguien otro monto, o dejarlo sin límite (ventas.presupuesto_ia).
-- * Al agotarse, el asistente le responde con el análisis automático por reglas (como con el tope global) y la
--   persona puede pedir una ampliación. Un admin la aprueba con un monto, que vale solo para ese mes, o la rechaza.
-- El gasto de una persona es lo que costaron sus preguntas, sus pruebas de modelo y la lectura de sus fotos en el mes
-- (hora de Honduras). El tope global sigue mandando: si se agota, nadie usa IA aunque le quede presupuesto.
-- Mismo patrón que el resto del asistente: RLS activo, sin acceso para anon/authenticated; todo va por funciones de
-- service_role que el servidor llama con el id del usuario ya verificado (sesión con 2FA).

alter table ventas.config_asistente
  add column if not exists presupuesto_usuario_usd numeric(10, 2) check (presupuesto_usuario_usd is null or presupuesto_usuario_usd > 0);

-- La foto de los cambios de configuración incluye el presupuesto general.
create or replace function interno._foto_config(c ventas.config_asistente) returns jsonb language sql immutable as $$
  select jsonb_build_object('usar_ia', c.usar_ia, 'modelo', c.modelo, 'tope_mensual_usd', c.tope_mensual_usd, 'presupuesto_usuario_usd', c.presupuesto_usuario_usd)
$$;

/** Cambia el presupuesto mensual general por persona (null = sin límite). No escribe nada si no cambió. */
create or replace function ventas.guardar_presupuesto_general(p_monto numeric, p_usuario uuid default null)
returns void language plpgsql set search_path = '' as $$
declare antes ventas.config_asistente; despues ventas.config_asistente; m numeric(10, 2) := round(p_monto, 2);
begin
  if m is not null and m <= 0 then raise exception 'El presupuesto debe ser mayor que cero.' using errcode = '22023'; end if;
  select * into antes from ventas.config_asistente where id for update;
  if antes.presupuesto_usuario_usd is not distinct from m then return; end if;
  update ventas.config_asistente set presupuesto_usuario_usd = m, actualizada_por = p_usuario, actualizada_en = now()
    where id returning * into despues;
  insert into ventas.config_asistente_cambio (antes, despues, usuario_id)
    values (interno._foto_config(antes), interno._foto_config(despues), p_usuario);
end $$;

-- Presupuesto propio de una persona. Sin fila = usa el general.
create table ventas.presupuesto_ia (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  mensual_usd numeric(10, 2) check (mensual_usd is null or mensual_usd > 0),
  sin_limite boolean not null default false,
  actualizado_por uuid references auth.users(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  constraint presupuesto_ia_monto_o_sin_limite check (sin_limite <> (mensual_usd is not null))
);

-- Solicitudes de ampliación. `mes`: primer día del mes (hora de Honduras) para el que se pidió; lo aprobado vale
-- solo ese mes.
create table ventas.ampliacion_ia (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  mes date not null,
  motivo text check (motivo is null or char_length(motivo) between 1 and 500),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  monto_usd numeric(10, 2) check (monto_usd is null or monto_usd > 0),
  respuesta text check (respuesta is null or char_length(respuesta) between 1 and 500),
  solicitada_en timestamptz not null default now(),
  resuelta_en timestamptz,
  resuelta_por uuid references auth.users(id) on delete set null,
  constraint ampliacion_aprobada_con_monto check ((estado = 'aprobada') = (monto_usd is not null))
);
-- Una sola solicitud pendiente por persona y mes.
create unique index ampliacion_ia_pendiente on ventas.ampliacion_ia (usuario_id, mes) where estado = 'pendiente';
create index on ventas.ampliacion_ia (estado, solicitada_en desc);
create index on ventas.ampliacion_ia (usuario_id, mes);

alter table ventas.presupuesto_ia enable row level security;
alter table ventas.ampliacion_ia enable row level security;
revoke all on ventas.presupuesto_ia, ventas.ampliacion_ia from public, anon, authenticated;
grant all on ventas.presupuesto_ia, ventas.ampliacion_ia to service_role;
grant usage, select on sequence ventas.ampliacion_ia_id_seq to service_role;

-- El gasto por persona se suma por usuario y mes.
create index if not exists consulta_asistente_usuario_mes on ventas.consulta_asistente (usuario_id, creado_en) where costo_usd is not null;

-- Por qué respondió el análisis automático habiendo IA: ahora también por el presupuesto de la persona.
alter table ventas.consulta_asistente drop constraint if exists consulta_asistente_motivo_automatico_check;
alter table ventas.consulta_asistente add constraint consulta_asistente_motivo_automatico_check
  check (motivo_automatico in ('tope_gasto', 'modelo_no_permitido', 'presupuesto_usuario'));

/** Primer instante del mes en curso en Honduras, y ese día como fecha. */
create or replace function interno.inicio_mes_hn() returns timestamptz language sql stable set search_path = '' as $$
  select date_trunc('month', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa'
$$;
create or replace function interno.mes_hn() returns date language sql stable set search_path = '' as $$
  select date_trunc('month', now() at time zone 'America/Tegucigalpa')::date
$$;

/**
 * Presupuesto y gasto de IA del mes de todas las personas con perfil (p_usuario nulo) o de una sola.
 * limite_usd nulo = sin límite. origen: 'propio' | 'general' | 'sin_limite'.
 */
create or replace function ventas.presupuestos_ia(p_usuario uuid default null)
returns jsonb language sql stable set search_path = '' as $$
  with general as (select presupuesto_usuario_usd g from ventas.config_asistente where id),
  personas as (
    select p.user_id, p.nombre, p.activo from public.perfil p where p_usuario is null or p.user_id = p_usuario
  ),
  gasto as (
    select usuario_id, sum(costo) costo, sum(preguntas) preguntas from (
      select usuario_id, coalesce(sum(costo_usd), 0) costo, count(*) filter (where costo_usd is not null) preguntas
        from ventas.consulta_asistente where creado_en >= interno.inicio_mes_hn() and usuario_id is not null group by 1
      union all
      select usuario_id, coalesce(sum(costo_usd), 0), 0 from ventas.prueba_modelo where creado_en >= interno.inicio_mes_hn() and usuario_id is not null group by 1
      union all
      select usuario_id, coalesce(sum(costo_usd), 0), 0 from ventas.adjunto where creado_en >= interno.inicio_mes_hn() group by 1
    ) x group by 1
  ),
  ampliado as (
    select usuario_id, sum(monto_usd) filter (where estado = 'aprobada') extra, bool_or(estado = 'pendiente') pendiente
    from ventas.ampliacion_ia where mes = interno.mes_hn() group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'usuario_id', pe.user_id, 'nombre', pe.nombre, 'activo', pe.activo, 'mes', interno.mes_hn(),
    'origen', case when pr.sin_limite then 'sin_limite' when pr.mensual_usd is not null then 'propio' when general.g is null then 'sin_limite' else 'general' end,
    'base_usd', case when pr.sin_limite then null else coalesce(pr.mensual_usd, general.g) end,
    'ampliaciones_usd', coalesce(a.extra, 0),
    'limite_usd', case when pr.sin_limite then null else coalesce(pr.mensual_usd, general.g) + coalesce(a.extra, 0) end,
    'gasto_usd', coalesce(g.costo, 0), 'preguntas', coalesce(g.preguntas, 0),
    'pendiente', coalesce(a.pendiente, false)
  ) order by pe.nombre), '[]'::jsonb)
  from personas pe cross join general
  left join ventas.presupuesto_ia pr on pr.usuario_id = pe.user_id
  left join gasto g on g.usuario_id = pe.user_id
  left join ampliado a on a.usuario_id = pe.user_id
$$;

/** Fija el presupuesto propio de una persona: un monto, sin límite, o (ambos nulos/falso) volver al general. */
create or replace function ventas.guardar_presupuesto_ia(p_usuario uuid, p_monto numeric, p_sin_limite boolean, p_admin uuid default null)
returns void language plpgsql set search_path = '' as $$
declare m numeric(10, 2) := round(p_monto, 2);
begin
  if not exists (select 1 from public.perfil where user_id = p_usuario) then
    raise exception 'Esa persona no tiene perfil.' using errcode = 'P0002';
  end if;
  if coalesce(p_sin_limite, false) then
    insert into ventas.presupuesto_ia (usuario_id, mensual_usd, sin_limite, actualizado_por) values (p_usuario, null, true, p_admin)
    on conflict (usuario_id) do update set mensual_usd = null, sin_limite = true, actualizado_por = p_admin, actualizado_en = now();
  elsif m is null then
    delete from ventas.presupuesto_ia where usuario_id = p_usuario;
  else
    if m <= 0 then raise exception 'El presupuesto debe ser mayor que cero.' using errcode = '22023'; end if;
    insert into ventas.presupuesto_ia (usuario_id, mensual_usd, sin_limite, actualizado_por) values (p_usuario, m, false, p_admin)
    on conflict (usuario_id) do update set mensual_usd = m, sin_limite = false, actualizado_por = p_admin, actualizado_en = now();
  end if;
end $$;

/** La persona pide más presupuesto para el mes en curso. Una pendiente a la vez. Devuelve el id. */
create or replace function ventas.solicitar_ampliacion_ia(p_usuario uuid, p_motivo text default null)
returns bigint language plpgsql set search_path = '' as $$
declare v_id bigint;
begin
  insert into ventas.ampliacion_ia (usuario_id, mes, motivo) values (p_usuario, interno.mes_hn(), nullif(trim(p_motivo), ''))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Ya tienes una solicitud pendiente este mes.' using errcode = 'P0001';
end $$;

/** Un admin aprueba (con un monto, que vale solo ese mes) o rechaza una solicitud pendiente. */
create or replace function ventas.resolver_ampliacion_ia(p_id bigint, p_aprobar boolean, p_monto numeric, p_respuesta text, p_admin uuid)
returns void language plpgsql set search_path = '' as $$
declare s ventas.ampliacion_ia; m numeric(10, 2) := round(p_monto, 2);
begin
  select * into s from ventas.ampliacion_ia where id = p_id for update;
  if not found then raise exception 'La solicitud ya no existe.' using errcode = 'P0002'; end if;
  if s.estado <> 'pendiente' then raise exception 'Esa solicitud ya fue resuelta.' using errcode = 'P0001'; end if;
  if p_aprobar and (m is null or m <= 0) then raise exception 'Indica el monto que apruebas, mayor que cero.' using errcode = '22023'; end if;
  update ventas.ampliacion_ia set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
    monto_usd = case when p_aprobar then m end, respuesta = nullif(trim(p_respuesta), ''), resuelta_en = now(), resuelta_por = p_admin
  where id = p_id;
end $$;

revoke execute on function
  ventas.guardar_presupuesto_general(numeric, uuid), ventas.presupuestos_ia(uuid), ventas.guardar_presupuesto_ia(uuid, numeric, boolean, uuid),
  ventas.solicitar_ampliacion_ia(uuid, text), ventas.resolver_ampliacion_ia(bigint, boolean, numeric, text, uuid),
  interno.inicio_mes_hn(), interno.mes_hn()
from public, anon, authenticated;
grant execute on function
  ventas.guardar_presupuesto_general(numeric, uuid), ventas.presupuestos_ia(uuid), ventas.guardar_presupuesto_ia(uuid, numeric, boolean, uuid),
  ventas.solicitar_ampliacion_ia(uuid, text), ventas.resolver_ampliacion_ia(bigint, boolean, numeric, text, uuid),
  interno.inicio_mes_hn(), interno.mes_hn()
to service_role;

notify pgrst, 'reload schema';
