-- G8: reglas del asistente administradas por un admin.
-- * Tres tipos: `instruccion` y `definicion` van en las instrucciones de sistema de cada llamada al modelo;
--   `bloqueo` lo aplica el código antes del modelo (términos que lo activan + mensaje que ve el usuario).
-- * Ninguna regla se salta las garantías fijas: las cifras salen de las consultas y se verifican, y el detalle de
--   clientes nunca va al modelo. Eso vive en el código, no aquí.
-- * Mismo patrón que cargas y conocimiento: RLS activo y sin acceso para anon/authenticated. El servidor lee las
--   reglas activas con service_role y los cambios van por funciones (solo service_role) que la server action llama
--   después de verificar que quien los pide es admin con 2FA. Cada cambio deja su fila en la bitácora en la misma
--   transacción, con el antes y el después.

create table ventas.regla_asistente (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('instruccion', 'definicion', 'bloqueo')),
  texto text not null check (length(texto) between 3 and 500 and texto !~ '[\r\n]'), -- una línea: va como viñeta en el prompt
  terminos text[] not null default '{}' check (cardinality(terminos) <= 20),
  activa boolean not null default true,
  creada_por uuid references auth.users(id) on delete set null,
  actualizada_por uuid references auth.users(id) on delete set null,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  constraint regla_bloqueo_con_terminos check (tipo <> 'bloqueo' or cardinality(terminos) > 0)
);
create index on ventas.regla_asistente (activa, creada_en);

-- Bitácora de cambios. Sin llave foránea a la regla: las filas quedan aunque la regla se elimine.
create table ventas.regla_asistente_cambio (
  id bigint generated always as identity primary key,
  regla_id uuid not null,
  accion text not null check (accion in ('creada', 'editada', 'activada', 'desactivada', 'eliminada')),
  antes jsonb,
  despues jsonb,
  usuario_id uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);
create index on ventas.regla_asistente_cambio (creado_en desc);
create index on ventas.regla_asistente_cambio (regla_id, creado_en desc);

alter table ventas.regla_asistente enable row level security;
alter table ventas.regla_asistente_cambio enable row level security;
revoke all on ventas.regla_asistente, ventas.regla_asistente_cambio from public, anon, authenticated;
grant all on ventas.regla_asistente, ventas.regla_asistente_cambio to service_role;
grant usage, select on sequence ventas.regla_asistente_cambio_id_seq to service_role;

-- Bitácora del asistente: ids de las reglas activas con que se respondió cada pregunta (null = antes de G8).
alter table ventas.consulta_asistente add column if not exists reglas uuid[];

-- Cambios ---------------------------------------------------------------------------------------------------------
-- Tope de reglas activas: cada una alarga las instrucciones del modelo y las vuelve más difíciles de seguir.
create or replace function interno.tope_reglas_asistente() returns int language sql immutable as $$ select 30 $$;

create or replace function interno._foto_regla(r ventas.regla_asistente) returns jsonb language sql immutable as $$
  select jsonb_build_object('tipo', r.tipo, 'texto', r.texto, 'terminos', to_jsonb(r.terminos), 'activa', r.activa)
$$;

create or replace function interno._exigir_tope_reglas() returns void language plpgsql as $$
begin
  -- Serializa altas y activaciones para que dos admins a la vez no pasen el tope.
  lock table ventas.regla_asistente in share row exclusive mode;
  if (select count(*) from ventas.regla_asistente where activa) >= interno.tope_reglas_asistente() then
    raise exception 'Ya hay % reglas activas, el máximo. Desactiva o elimina alguna antes de agregar otra.', interno.tope_reglas_asistente();
  end if;
end $$;

/** Crea (p_id nulo) o edita una regla. Las reglas que no son de bloqueo no guardan términos. */
create or replace function ventas.guardar_regla_asistente(p_id uuid, p_tipo text, p_texto text, p_terminos text[], p_usuario uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  antes ventas.regla_asistente;
  r ventas.regla_asistente;
  t text[] := case when p_tipo = 'bloqueo' then coalesce(p_terminos, '{}') else '{}' end;
begin
  if p_id is null then
    perform interno._exigir_tope_reglas();
    insert into ventas.regla_asistente (tipo, texto, terminos, creada_por, actualizada_por)
    values (p_tipo, trim(p_texto), t, p_usuario, p_usuario) returning * into r;
    insert into ventas.regla_asistente_cambio (regla_id, accion, despues, usuario_id) values (r.id, 'creada', interno._foto_regla(r), p_usuario);
  else
    select * into antes from ventas.regla_asistente where id = p_id for update;
    if not found then raise exception 'La regla ya no existe; recarga la página.'; end if;
    update ventas.regla_asistente set tipo = p_tipo, texto = trim(p_texto), terminos = t, actualizada_por = p_usuario, actualizada_en = now()
    where id = p_id returning * into r;
    insert into ventas.regla_asistente_cambio (regla_id, accion, antes, despues, usuario_id)
    values (r.id, 'editada', interno._foto_regla(antes), interno._foto_regla(r), p_usuario);
  end if;
  return jsonb_build_object('id', r.id);
end $$;

create or replace function ventas.activar_regla_asistente(p_id uuid, p_activa boolean, p_usuario uuid default null)
returns void language plpgsql set search_path = '' as $$
declare antes ventas.regla_asistente; r ventas.regla_asistente;
begin
  if p_activa then perform interno._exigir_tope_reglas(); end if;
  select * into antes from ventas.regla_asistente where id = p_id for update;
  if not found then raise exception 'La regla ya no existe; recarga la página.'; end if;
  if antes.activa = p_activa then return; end if;
  update ventas.regla_asistente set activa = p_activa, actualizada_por = p_usuario, actualizada_en = now() where id = p_id returning * into r;
  insert into ventas.regla_asistente_cambio (regla_id, accion, antes, despues, usuario_id)
  values (r.id, case when p_activa then 'activada' else 'desactivada' end, interno._foto_regla(antes), interno._foto_regla(r), p_usuario);
end $$;

create or replace function ventas.eliminar_regla_asistente(p_id uuid, p_usuario uuid default null)
returns void language plpgsql set search_path = '' as $$
declare antes ventas.regla_asistente;
begin
  delete from ventas.regla_asistente where id = p_id returning * into antes;
  if not found then raise exception 'La regla ya no existe; recarga la página.'; end if;
  insert into ventas.regla_asistente_cambio (regla_id, accion, antes, usuario_id) values (p_id, 'eliminada', interno._foto_regla(antes), p_usuario);
end $$;

-- Solo service_role: el servidor verifica antes que quien lo pide sea admin con 2FA.
revoke execute on function
  ventas.guardar_regla_asistente(uuid, text, text, text[], uuid), ventas.activar_regla_asistente(uuid, boolean, uuid),
  ventas.eliminar_regla_asistente(uuid, uuid), interno.tope_reglas_asistente(), interno._foto_regla(ventas.regla_asistente),
  interno._exigir_tope_reglas()
from public, anon, authenticated;
grant execute on function
  ventas.guardar_regla_asistente(uuid, text, text, text[], uuid), ventas.activar_regla_asistente(uuid, boolean, uuid),
  ventas.eliminar_regla_asistente(uuid, uuid), interno.tope_reglas_asistente(), interno._foto_regla(ventas.regla_asistente),
  interno._exigir_tope_reglas()
to service_role;

notify pgrst, 'reload schema';
