-- G9: uso del asistente.
-- * Costo por pregunta: tokens de entrada y salida y costo en dólares que informa OpenRouter, sumados en todas
--   las rondas de herramientas. También el de las pruebas de modelo (no son preguntas, pero gastan).
-- * Tope de gasto mensual (opcional) en la configuración del asistente, con su bitácora de cambios. Al llegar al
--   tope, el asistente responde con el análisis automático y la pregunta queda marcada en la bitácora.
-- * Valoración de cada respuesta (útil / no útil + comentario) e informe personal (respuestas fijadas).
-- Mismo patrón que la bitácora (0012) y la configuración (0013): RLS activo; cada quien lee solo lo suyo y todas
-- las escrituras van por funciones de service_role que el servidor llama con el id del usuario ya verificado
-- (sesión con 2FA). Las funciones comprueban de nuevo que el turno sea de ese usuario.

-- Costo por pregunta ----------------------------------------------------------------------------------------------
alter table ventas.consulta_asistente
  add column if not exists tokens_entrada int check (tokens_entrada >= 0),
  add column if not exists tokens_salida int check (tokens_salida >= 0),
  add column if not exists costo_usd numeric(14, 8) check (costo_usd >= 0),
  -- OpenRouter no informó el costo y se calculó con los precios del catálogo.
  add column if not exists costo_estimado boolean not null default false,
  -- Por qué respondió el análisis automático habiendo IA configurada (null = no aplica).
  add column if not exists motivo_automatico text check (motivo_automatico in ('tope_gasto', 'modelo_no_permitido'));

-- Pruebas de modelo (botón «Probar» de la configuración): no van a la bitácora, pero su costo cuenta para el tope.
create table if not exists ventas.prueba_modelo (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  usuario_id uuid references auth.users(id) on delete set null,
  modelo text not null,
  tokens_entrada int check (tokens_entrada >= 0),
  tokens_salida int check (tokens_salida >= 0),
  costo_usd numeric(14, 8) check (costo_usd >= 0),
  costo_estimado boolean not null default false
);
create index if not exists prueba_modelo_creado_en_idx on ventas.prueba_modelo (creado_en desc);
alter table ventas.prueba_modelo enable row level security;
revoke all on ventas.prueba_modelo from public, anon, authenticated;
grant all on ventas.prueba_modelo to service_role;
grant usage, select on sequence ventas.prueba_modelo_id_seq to service_role;

-- Tope mensual ----------------------------------------------------------------------------------------------------
alter table ventas.config_asistente
  add column if not exists tope_mensual_usd numeric(10, 2) check (tope_mensual_usd is null or tope_mensual_usd > 0);

create or replace function interno._foto_config(c ventas.config_asistente) returns jsonb language sql immutable as $$
  select jsonb_build_object('usar_ia', c.usar_ia, 'modelo', c.modelo, 'tope_mensual_usd', c.tope_mensual_usd)
$$;
revoke execute on function interno._foto_config(ventas.config_asistente) from public, anon, authenticated;
grant execute on function interno._foto_config(ventas.config_asistente) to service_role;

/** Misma firma que en 0013; ahora la foto del cambio incluye el tope. */
create or replace function ventas.guardar_config_asistente(p_usar_ia boolean, p_modelo text, p_usuario uuid default null)
returns void language plpgsql set search_path = '' as $$
declare antes ventas.config_asistente; despues ventas.config_asistente; m text := nullif(trim(p_modelo), '');
begin
  select * into antes from ventas.config_asistente where id for update;
  if antes.usar_ia = p_usar_ia and antes.modelo is not distinct from m then return; end if;
  update ventas.config_asistente set usar_ia = p_usar_ia, modelo = m, actualizada_por = p_usuario, actualizada_en = now()
    where id returning * into despues;
  insert into ventas.config_asistente_cambio (antes, despues, usuario_id)
    values (interno._foto_config(antes), interno._foto_config(despues), p_usuario);
end $$;

/** Cambia el tope de gasto mensual (null = sin tope). No escribe nada si no cambió. */
create or replace function ventas.guardar_tope_asistente(p_tope numeric, p_usuario uuid default null)
returns void language plpgsql set search_path = '' as $$
declare antes ventas.config_asistente; despues ventas.config_asistente; t numeric(10, 2) := round(p_tope, 2);
begin
  if t is not null and t <= 0 then raise exception 'El tope debe ser mayor que cero.' using errcode = '22023'; end if;
  select * into antes from ventas.config_asistente where id for update;
  if antes.tope_mensual_usd is not distinct from t then return; end if;
  update ventas.config_asistente set tope_mensual_usd = t, actualizada_por = p_usuario, actualizada_en = now()
    where id returning * into despues;
  insert into ventas.config_asistente_cambio (antes, despues, usuario_id)
    values (interno._foto_config(antes), interno._foto_config(despues), p_usuario);
end $$;

revoke execute on function ventas.guardar_config_asistente(boolean, text, uuid) from public, anon, authenticated;
grant execute on function ventas.guardar_config_asistente(boolean, text, uuid) to service_role;
revoke execute on function ventas.guardar_tope_asistente(numeric, uuid) from public, anon, authenticated;
grant execute on function ventas.guardar_tope_asistente(numeric, uuid) to service_role;

/**
 * Gasto del mes en curso (hora de Honduras): preguntas + pruebas de modelo. Sirve para el tope y para la
 * pestaña «Modelo de IA». Solo service_role.
 */
create or replace function ventas.gasto_asistente_mes()
returns jsonb language sql stable set search_path = '' as $$
  with desde as (
    select (date_trunc('month', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa') as d
  ), c as (
    select coalesce(sum(costo_usd), 0) as costo, count(*) filter (where costo_usd is not null) as n
    from ventas.consulta_asistente, desde where creado_en >= desde.d
  ), p as (
    select coalesce(sum(costo_usd), 0) as costo, count(*) as n from ventas.prueba_modelo, desde where creado_en >= desde.d
  )
  select jsonb_build_object('desde', desde.d, 'total_usd', c.costo + p.costo, 'preguntas_usd', c.costo,
    'preguntas', c.n, 'pruebas_usd', p.costo, 'pruebas', p.n)
  from desde, c, p
$$;
revoke execute on function ventas.gasto_asistente_mes() from public, anon, authenticated;
grant execute on function ventas.gasto_asistente_mes() to service_role;

-- Valoración de respuestas ----------------------------------------------------------------------------------------
create table if not exists ventas.valoracion_respuesta (
  consulta_id bigint primary key references ventas.consulta_asistente(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  util boolean not null,
  comentario text check (comentario is null or char_length(comentario) between 1 and 1000),
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);
create index if not exists valoracion_respuesta_usuario_idx on ventas.valoracion_respuesta (usuario_id);

alter table ventas.valoracion_respuesta enable row level security;
revoke all on ventas.valoracion_respuesta from public, anon, authenticated;
grant all on ventas.valoracion_respuesta to service_role;
grant select on ventas.valoracion_respuesta to authenticated;
drop policy if exists "valoración: cada quien lee las suyas" on ventas.valoracion_respuesta;
create policy "valoración: cada quien lee las suyas" on ventas.valoracion_respuesta for select to authenticated
  using (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null);

/**
 * Valora un turno propio con respuesta. p_util null = quitar la valoración. Error P0002 si el turno no existe,
 * no tiene respuesta o es de otro usuario (las tres se ven igual desde afuera).
 */
create or replace function ventas.valorar_respuesta(p_usuario uuid, p_consulta bigint, p_util boolean, p_comentario text default null)
returns void language plpgsql set search_path = '' as $$
declare c text := nullif(btrim(p_comentario), '');
begin
  if p_usuario is null or not exists (
    select 1 from ventas.consulta_asistente where id = p_consulta and usuario_id = p_usuario and respuesta is not null
  ) then
    raise exception 'turno no encontrado' using errcode = 'P0002';
  end if;
  if p_util is null then
    delete from ventas.valoracion_respuesta where consulta_id = p_consulta and usuario_id = p_usuario;
    return;
  end if;
  insert into ventas.valoracion_respuesta (consulta_id, usuario_id, util, comentario)
    values (p_consulta, p_usuario, p_util, c)
  on conflict (consulta_id) do update set util = excluded.util, comentario = excluded.comentario, actualizada_en = now()
    where ventas.valoracion_respuesta.usuario_id = p_usuario;
end $$;
revoke execute on function ventas.valorar_respuesta(uuid, bigint, boolean, text) from public, anon, authenticated;
grant execute on function ventas.valorar_respuesta(uuid, bigint, boolean, text) to service_role;

-- Informe ---------------------------------------------------------------------------------------------------------
create table if not exists ventas.informe_item (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  consulta_id bigint not null references ventas.consulta_asistente(id) on delete cascade,
  orden int not null default 0,
  titulo text check (titulo is null or char_length(titulo) between 1 and 160),
  nota text check (nota is null or char_length(nota) between 1 and 2000),
  creado_en timestamptz not null default now(),
  unique (usuario_id, consulta_id)
);
create index if not exists informe_item_usuario_idx on ventas.informe_item (usuario_id, orden);

alter table ventas.informe_item enable row level security;
revoke all on ventas.informe_item from public, anon, authenticated;
grant all on ventas.informe_item to service_role;
grant usage, select on sequence ventas.informe_item_id_seq to service_role;
grant select on ventas.informe_item to authenticated;
drop policy if exists "informe: cada quien lee el suyo" on ventas.informe_item;
create policy "informe: cada quien lee el suyo" on ventas.informe_item for select to authenticated
  using (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null);

/** Tope de respuestas en un informe: es para imprimir, no un archivo. */
create or replace function interno.tope_informe() returns int language sql immutable as $$ select 50 $$;

/** Agrega un turno propio con respuesta al final del informe. Idempotente. P0002 si no es suyo. */
create or replace function ventas.informe_agregar(p_usuario uuid, p_consulta bigint)
returns void language plpgsql set search_path = '' as $$
begin
  if p_usuario is null or not exists (
    select 1 from ventas.consulta_asistente where id = p_consulta and usuario_id = p_usuario and respuesta is not null
  ) then
    raise exception 'turno no encontrado' using errcode = 'P0002';
  end if;
  if exists (select 1 from ventas.informe_item where usuario_id = p_usuario and consulta_id = p_consulta) then return; end if;
  if (select count(*) from ventas.informe_item where usuario_id = p_usuario) >= interno.tope_informe() then
    raise exception 'El informe ya tiene % respuestas, el máximo. Quita alguna antes de agregar otra.', interno.tope_informe()
      using errcode = '54000';
  end if;
  insert into ventas.informe_item (usuario_id, consulta_id, orden)
    values (p_usuario, p_consulta, coalesce((select max(orden) + 1 from ventas.informe_item where usuario_id = p_usuario), 0))
  on conflict (usuario_id, consulta_id) do nothing;
end $$;

/** Quita un turno del informe del usuario. Devuelve si había algo que quitar. */
create or replace function ventas.informe_quitar(p_usuario uuid, p_consulta bigint)
returns boolean language plpgsql set search_path = '' as $$
declare n int;
begin
  delete from ventas.informe_item where usuario_id = p_usuario and consulta_id = p_consulta;
  get diagnostics n = row_count;
  return n > 0;
end $$;

/** Título y nota de un elemento del informe (vacío = sin título / sin nota). Devuelve si existía. */
create or replace function ventas.informe_editar(p_usuario uuid, p_consulta bigint, p_titulo text, p_nota text)
returns boolean language plpgsql set search_path = '' as $$
declare n int;
begin
  update ventas.informe_item set titulo = nullif(btrim(p_titulo), ''), nota = nullif(btrim(p_nota), '')
    where usuario_id = p_usuario and consulta_id = p_consulta;
  get diagnostics n = row_count;
  return n > 0;
end $$;

/**
 * Nuevo orden: p_consultas debe traer exactamente los turnos del informe del usuario, sin repetir. Si no, no
 * cambia nada (el informe pudo cambiar en otra pestaña) y devuelve false.
 */
create or replace function ventas.informe_ordenar(p_usuario uuid, p_consultas bigint[])
returns boolean language plpgsql set search_path = '' as $$
begin
  perform 1 from ventas.informe_item where usuario_id = p_usuario for update;
  if cardinality(p_consultas) <> (select count(distinct x) from unnest(p_consultas) x)
     or (select array_agg(consulta_id order by consulta_id) from ventas.informe_item where usuario_id = p_usuario)
        is distinct from (select array_agg(x order by x) from unnest(p_consultas) x) then
    return false;
  end if;
  update ventas.informe_item i set orden = o.pos
    from unnest(p_consultas) with ordinality as o(consulta_id, pos)
    where i.usuario_id = p_usuario and i.consulta_id = o.consulta_id;
  return true;
end $$;

revoke execute on function interno.tope_informe() from public, anon, authenticated;
grant execute on function interno.tope_informe() to service_role;
revoke execute on function ventas.informe_agregar(uuid, bigint) from public, anon, authenticated;
revoke execute on function ventas.informe_quitar(uuid, bigint) from public, anon, authenticated;
revoke execute on function ventas.informe_editar(uuid, bigint, text, text) from public, anon, authenticated;
revoke execute on function ventas.informe_ordenar(uuid, bigint[]) from public, anon, authenticated;
grant execute on function ventas.informe_agregar(uuid, bigint) to service_role;
grant execute on function ventas.informe_quitar(uuid, bigint) to service_role;
grant execute on function ventas.informe_editar(uuid, bigint, text, text) to service_role;
grant execute on function ventas.informe_ordenar(uuid, bigint[]) to service_role;

notify pgrst, 'reload schema';
