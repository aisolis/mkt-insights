-- G5: acceso cerrado por perfil (S16).
-- * Las tablas de ventas siguen sin grants para anon/authenticated (RLS activo y sin políticas = negado): nadie
--   lee filas de hecho por la API. Toda cifra sale de funciones de agregados.
-- * Las funciones de lectura pasan a `interno` (esquema no expuesto) y en `ventas` quedan envoltorios
--   SECURITY DEFINER que primero exigen sesión con 2FA (aal2) y perfil activo. Devuelven solo agregados, así que
--   Estándar ve conteos de clientes pero nunca su código ni su nombre; las funciones con detalle de cliente
--   (cuando existan) piden nivel 'plus' con interno.exigir_acceso('plus').
-- * service_role (scripts, ingesta, pruebas) pasa sin perfil.

create schema if not exists interno;
revoke all on schema interno from public, anon, authenticated;

-- Perfil -------------------------------------------------------------------------------------------------------
alter table public.perfil
  add column activo boolean not null default true,
  add column creado_en timestamptz not null default now(),
  add column invitado_por uuid references auth.users(id) on delete set null;

-- Supabase da ALL en public a anon/authenticated: se deja solo lectura del propio perfil. Altas y cambios van
-- por el servidor (service_role) después de verificar que quien los pide es admin con 2FA.
revoke all on public.perfil from anon, authenticated;
grant select on public.perfil to authenticated;
grant all on public.perfil to service_role;
create policy "perfil: cada quien lee el suyo" on public.perfil for select to authenticated
  using (user_id = (select auth.uid()));

-- Nivel de acceso de la sesión actual: 'plus' | 'estandar' | 'servicio' | null (sin 2FA, sin perfil o inactivo).
create or replace function interno.nivel_acceso() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when (select auth.jwt() ->> 'role') = 'service_role' then 'servicio'
    when coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then null
    else (select p.nivel from public.perfil p where p.user_id = (select auth.uid()) and p.activo)
  end
$$;

create or replace function interno.exigir_acceso(p_nivel text default 'estandar') returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text := interno.nivel_acceso();
begin
  if v is null then
    raise exception 'acceso denegado: se requiere sesión con 2FA y perfil activo' using errcode = '42501';
  end if;
  if p_nivel = 'plus' and v not in ('plus', 'servicio') then
    raise exception 'acceso denegado: requiere perfil Plus' using errcode = '42501';
  end if;
  return v;
end $$;

-- authenticated necesita el esquema solo para la política de la bitácora (interno.nivel_acceso).
grant usage on schema interno to authenticated, service_role;

-- Funciones de lectura: implementación a `interno`, envoltorio con control de acceso en `ventas` ----------------
alter function ventas.version_vigente() set schema interno;
alter function ventas.kpi_periodo(int, int, int, int, int, jsonb) set schema interno;
alter function ventas.variacion_por_dimension(int, text, int, int, int, int, jsonb) set schema interno;
alter function ventas.top_contribuyentes(int, int, int, int, int, jsonb, int) set schema interno;
alter function ventas.serie_mensual(int, int, jsonb) set schema interno;
alter function ventas.descomposicion(int, int, int, int, int, jsonb) set schema interno;
revoke execute on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.nivel_acceso() to authenticated;

create function ventas.version_vigente() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return interno.version_vigente();
end $$;

create function ventas.kpi_periodo(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return interno.kpi_periodo(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros);
end $$;

create function ventas.variacion_por_dimension(
  p_version int, p_dimension text, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return interno.variacion_por_dimension(p_version, p_dimension, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros);
end $$;

create function ventas.top_contribuyentes(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}', p_limite int default 10
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return interno.top_contribuyentes(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros, p_limite);
end $$;

create function ventas.serie_mensual(p_version int, p_anio int, p_filtros jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return interno.serie_mensual(p_version, p_anio, p_filtros);
end $$;

create function ventas.descomposicion(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return interno.descomposicion(p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros);
end $$;

-- Postgres da EXECUTE a PUBLIC en toda función nueva: en `ventas` (expuesto) solo quedan llamables los envoltorios.
revoke execute on all functions in schema ventas from public, anon, authenticated;
alter default privileges in schema ventas revoke execute on functions from public;
alter default privileges in schema interno revoke execute on functions from public;
grant execute on function
  ventas.version_vigente(), ventas.kpi_periodo(int, int, int, int, int, jsonb),
  ventas.variacion_por_dimension(int, text, int, int, int, int, jsonb),
  ventas.top_contribuyentes(int, int, int, int, int, jsonb, int), ventas.serie_mensual(int, int, jsonb),
  ventas.descomposicion(int, int, int, int, int, jsonb)
to authenticated;
grant execute on all functions in schema ventas to service_role;
grant execute on all functions in schema interno to service_role;

-- Bitácora del asistente: cada quien escribe y lee sus propias preguntas -----------------------------------------
grant select, insert on ventas.consulta_asistente to authenticated;
grant usage, select on sequence ventas.consulta_asistente_id_seq to authenticated;
create policy "bitácora: registra el propio usuario con acceso" on ventas.consulta_asistente for insert to authenticated
  with check (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null);
create policy "bitácora: cada quien lee las suyas" on ventas.consulta_asistente for select to authenticated
  using (usuario_id = (select auth.uid()));

notify pgrst, 'reload schema';
