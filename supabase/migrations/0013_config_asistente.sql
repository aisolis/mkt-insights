-- Configuración del asistente (G8): qué modelo de IA redacta y si se usa IA o solo el análisis automático.
-- Una sola fila. La llave de OpenRouter sigue en el entorno del servidor (nunca en la base ni en la pantalla);
-- modelo nulo = el del entorno (OPENROUTER_MODEL) o el de fábrica. Cada cambio queda en la bitácora de cambios.

create table ventas.config_asistente (
  id boolean primary key default true check (id),
  usar_ia boolean not null default true,
  modelo text check (modelo is null or modelo ~ '^[a-z0-9][a-z0-9._-]*/[A-Za-z0-9._:-]+$'),
  actualizada_por uuid references auth.users(id) on delete set null,
  actualizada_en timestamptz not null default now()
);
insert into ventas.config_asistente (id) values (true);

create table ventas.config_asistente_cambio (
  id bigint generated always as identity primary key,
  antes jsonb not null,
  despues jsonb not null,
  usuario_id uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);
create index on ventas.config_asistente_cambio (creado_en desc);

alter table ventas.config_asistente enable row level security;
alter table ventas.config_asistente_cambio enable row level security;
revoke all on ventas.config_asistente, ventas.config_asistente_cambio from public, anon, authenticated;
grant all on ventas.config_asistente, ventas.config_asistente_cambio to service_role;
grant usage, select on sequence ventas.config_asistente_cambio_id_seq to service_role;


/** Guarda la configuración y su cambio en la misma transacción. No escribe nada si no cambió. */
create or replace function ventas.guardar_config_asistente(p_usar_ia boolean, p_modelo text, p_usuario uuid default null)
returns void language plpgsql set search_path = '' as $$
declare antes ventas.config_asistente; m text := nullif(trim(p_modelo), '');
begin
  select * into antes from ventas.config_asistente where id for update;
  if antes.usar_ia = p_usar_ia and antes.modelo is not distinct from m then return; end if;
  update ventas.config_asistente set usar_ia = p_usar_ia, modelo = m, actualizada_por = p_usuario, actualizada_en = now() where id;
  insert into ventas.config_asistente_cambio (antes, despues, usuario_id) values (
    jsonb_build_object('usar_ia', antes.usar_ia, 'modelo', antes.modelo),
    jsonb_build_object('usar_ia', p_usar_ia, 'modelo', m),
    p_usuario
  );
end $$;

revoke execute on function ventas.guardar_config_asistente(boolean, text, uuid) from public, anon, authenticated;
grant execute on function ventas.guardar_config_asistente(boolean, text, uuid) to service_role;

notify pgrst, 'reload schema';
