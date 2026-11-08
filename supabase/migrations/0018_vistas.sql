-- Vistas guardadas del dashboard (G9): una combinación de periodo, comparación y filtros con nombre, para volver a
-- ella con un clic. `consulta` es la query string del dashboard ya normalizada por el servidor (leerParams +
-- queryString): solo parámetros conocidos. Sin `periodo` = "siempre el último mes" (el dashboard toma el último
-- mes cerrado al abrirla).
-- Acceso: cada quien lee las suyas y las compartidas con el equipo; solo el dueño crea, cambia y borra. Todo exige
-- sesión con 2FA y perfil activo (interno.nivel_acceso()).

create table ventas.vista_guardada (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 60 and nombre = btrim(nombre)),
  consulta text not null default '' check (char_length(consulta) <= 2000 and consulta !~ '^\?'),
  compartida boolean not null default false,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);
-- Un nombre no se repite entre las vistas de una misma persona (sin distinguir mayúsculas).
create unique index vista_guardada_nombre_unico on ventas.vista_guardada (usuario_id, lower(nombre));
create index on ventas.vista_guardada (compartida) where compartida;

create or replace function interno.vista_guardada_actualizada() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizada_en := now();
  return new;
end $$;
create trigger vista_guardada_actualizada before update on ventas.vista_guardada
  for each row execute function interno.vista_guardada_actualizada();

alter table ventas.vista_guardada enable row level security;
revoke all on ventas.vista_guardada from public, anon, authenticated;
grant all on ventas.vista_guardada to service_role;
-- Columnas acotadas: nadie fija sus fechas ni cambia el dueño de una vista.
grant select, delete on ventas.vista_guardada to authenticated;
grant insert (usuario_id, nombre, consulta, compartida) on ventas.vista_guardada to authenticated;
grant update (nombre, consulta, compartida) on ventas.vista_guardada to authenticated;

create policy "vista: lee las suyas y las compartidas" on ventas.vista_guardada for select to authenticated
  using ((usuario_id = (select auth.uid()) or compartida) and (select interno.nivel_acceso()) is not null);
create policy "vista: crea el propio usuario con acceso" on ventas.vista_guardada for insert to authenticated
  with check (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null);
create policy "vista: solo el dueño la cambia" on ventas.vista_guardada for update to authenticated
  using (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null)
  with check (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null);
create policy "vista: solo el dueño la borra" on ventas.vista_guardada for delete to authenticated
  using (usuario_id = (select auth.uid()) and (select interno.nivel_acceso()) is not null);

-- Nombre de quien la creó, como campo calculado de PostgREST (select=…,autor:autor_vista). public.perfil solo deja
-- leer el propio, así que la función es SECURITY DEFINER y revisa por su cuenta lo mismo que la política de
-- lectura: el propio nombre siempre; el de otra persona solo si la vista existe, es de ella y está compartida.
-- Llamada con una fila inventada (otro id o una vista privada ajena) devuelve null: no sirve para listar nombres
-- del equipo. (La propia no se busca en la tabla: al crearla, PostgREST evalúa el campo en la misma sentencia del
-- insert y la fila nueva todavía no se ve.)
create or replace function ventas.autor_vista(v ventas.vista_guardada) returns text
language sql stable security definer set search_path = '' as $$
  select p.nombre from public.perfil p
  where p.user_id = v.usuario_id
    and (select interno.nivel_acceso()) is not null
    and (
      v.usuario_id = (select auth.uid())
      or exists (select 1 from ventas.vista_guardada g where g.id = v.id and g.usuario_id = v.usuario_id and g.compartida)
    )
$$;
revoke execute on function ventas.autor_vista(ventas.vista_guardada) from public, anon;
grant execute on function ventas.autor_vista(ventas.vista_guardada) to authenticated, service_role;

notify pgrst, 'reload schema';
