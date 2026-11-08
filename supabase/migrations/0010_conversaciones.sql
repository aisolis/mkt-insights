-- Conversaciones del asistente (G8): cada chat es una conversación propia del usuario, así un hilo largo no
-- contamina a otros y la memoria del modelo queda acotada (últimos turnos + última consulta estructurada).
-- Los turnos siguen en la bitácora (ventas.consulta_asistente), ahora con conversacion_id.

create table ventas.conversacion (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null check (char_length(btrim(titulo)) between 1 and 120),
  contexto text not null default '',          -- query string del dashboard con la que empezó
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  archivada_en timestamptz
);
create index on ventas.conversacion (usuario_id, actualizada_en desc);

alter table ventas.conversacion enable row level security;
grant all on ventas.conversacion to service_role;
-- Sin delete: archivar es un update (archivada_en). Al borrar el usuario se borran por cascada.
grant select, insert, update on ventas.conversacion to authenticated;

create policy "conversación: cada quien lee las suyas" on ventas.conversacion for select to authenticated
  using (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null);
create policy "conversación: crea el propio usuario con acceso" on ventas.conversacion for insert to authenticated
  with check (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null);
create policy "conversación: cada quien cambia las suyas" on ventas.conversacion for update to authenticated
  using (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null)
  with check (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null);

-- Turnos: cada pregunta de la bitácora pertenece (o no, las anteriores a G8) a una conversación.
alter table ventas.consulta_asistente
  add column conversacion_id uuid references ventas.conversacion(id) on delete cascade;
create index on ventas.consulta_asistente (conversacion_id, creado_en);

-- La política de insert de la bitácora ya exige usuario_id = auth.uid(); además, la conversación debe ser del
-- mismo usuario (no se puede colgar una pregunta en la conversación de otro).
drop policy "bitácora: registra el propio usuario con acceso" on ventas.consulta_asistente;
create policy "bitácora: registra el propio usuario con acceso" on ventas.consulta_asistente for insert to authenticated
  with check (
    usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null
    and (conversacion_id is null or exists (
      select 1 from ventas.conversacion c where c.id = conversacion_id and c.usuario_id = (select auth.uid())
    ))
  );

notify pgrst, 'reload schema';
