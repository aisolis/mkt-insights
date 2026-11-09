-- G11 (V1-02, S33): ámbito de datos por persona (empresa, canal y/o ruta), aparte del perfil Estándar/Plus y del rol.
-- Se aplica en la base, no en la pantalla: las funciones de lectura de ventas pasan a ejecutarse como el rol
-- lector_ventas (sin BYPASSRLS) y las tablas de hechos tienen una política que deja ver solo las filas del ámbito de
-- quien consulta. Así cada KPI, desglose, serie, cliente, respuesta del asistente y exportación queda dentro del ámbito
-- aunque alguien llame la función directo con su sesión o manipule filtros. Sin ámbito (null) = toda la venta interna.
-- service_role (scripts, ingesta, pruebas) ve todo.

alter table public.perfil add column if not exists alcance jsonb check (
  alcance is null or (jsonb_typeof(alcance) = 'object' and alcance - array['empresa', 'canal', 'ruta'] = '{}'::jsonb)
);
comment on column public.perfil.alcance is 'Ámbito de datos: {"empresa": [...], "canal": [...], "ruta": [...]}; null = todo. Cada lista restringe; las listas se combinan con Y.';

/** Ámbito de quien consulta: null si no tiene (o si es service_role). Se lee una vez por consulta (initplan). */
create or replace function interno.alcance_sesion() returns jsonb
language sql stable set search_path = '' as $$
  select case
    when coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then null
    else (select p.alcance from public.perfil p where p.user_id = (select auth.uid()) and p.activo)
  end
$$;

/** Valores permitidos de una dimensión, o null si esa dimensión no está restringida. */
create or replace function interno.alcance_lista(p_dim text) returns text[]
language sql stable set search_path = '' as $$
  select case when a ? p_dim then array(select jsonb_array_elements_text(a -> p_dim)) end
  from (select interno.alcance_sesion() a) x
$$;

-- Rol dueño de las funciones de lectura: sin BYPASSRLS, solo lectura de lo que esas funciones necesitan.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'lector_ventas') then create role lector_ventas nologin nobypassrls; end if;
end $$;
grant lector_ventas to postgres;  -- para poder cederle las funciones
-- Hereda de authenticated el acceso a auth.uid()/auth.jwt() (las funciones leen la sesión de quien consulta); ese rol
-- no tiene permisos sobre las tablas de ventas, así que no le agrega lectura de cifras.
grant authenticated to lector_ventas;
grant usage on schema ventas, interno, public to lector_ventas;
grant create on schema ventas to lector_ventas;  -- requisito de ALTER FUNCTION … OWNER
grant execute on all functions in schema interno, ventas to lector_ventas;  -- solo lo usan las funciones que son suyas
grant select on ventas.hecho, ventas.resumen_mensual, ventas.carga, ventas.carga_mes, ventas.homologacion, ventas.publicacion,
  ventas.version_mes, ventas.regla_asistente, public.perfil to lector_ventas;

-- Tablas de apoyo: el lector las ve completas (no traen cifras por fila de venta).
drop policy if exists "lector: carga" on ventas.carga;
create policy "lector: carga" on ventas.carga for select to lector_ventas using (true);
drop policy if exists "lector: carga_mes" on ventas.carga_mes;
create policy "lector: carga_mes" on ventas.carga_mes for select to lector_ventas using (true);
drop policy if exists "lector: homologacion" on ventas.homologacion;
create policy "lector: homologacion" on ventas.homologacion for select to lector_ventas using (true);
drop policy if exists "lector: publicacion" on ventas.publicacion;
create policy "lector: publicacion" on ventas.publicacion for select to lector_ventas using (true);
drop policy if exists "lector: version_mes" on ventas.version_mes;
create policy "lector: version_mes" on ventas.version_mes for select to lector_ventas using (true);
drop policy if exists "lector: regla_asistente" on ventas.regla_asistente;
create policy "lector: regla_asistente" on ventas.regla_asistente for select to lector_ventas using (true);
drop policy if exists "lector: perfil" on public.perfil;
create policy "lector: perfil" on public.perfil for select to lector_ventas using (true);

-- Hechos y resumen: solo el ámbito de quien consulta. Las listas se calculan una vez por consulta.
drop policy if exists "lector: hecho en su ámbito" on ventas.hecho;
create policy "lector: hecho en su ámbito" on ventas.hecho for select to lector_ventas using (
  (select interno.alcance_sesion()) is null or (
        ((select interno.alcance_lista('empresa')) is null or empresa = any((select interno.alcance_lista('empresa'))::text[]))
    and ((select interno.alcance_lista('canal')) is null or canal = any((select interno.alcance_lista('canal'))::text[]))
    and ((select interno.alcance_lista('ruta')) is null or ruta = any((select interno.alcance_lista('ruta'))::text[]))
  )
);
drop policy if exists "lector: resumen en su ámbito" on ventas.resumen_mensual;
create policy "lector: resumen en su ámbito" on ventas.resumen_mensual for select to lector_ventas using (
  (select interno.alcance_sesion()) is null or (
        ((select interno.alcance_lista('empresa')) is null or empresa = any((select interno.alcance_lista('empresa'))::text[]))
    and ((select interno.alcance_lista('canal')) is null or canal = any((select interno.alcance_lista('canal'))::text[]))
    and ((select interno.alcance_lista('ruta')) is null or ruta = any((select interno.alcance_lista('ruta'))::text[]))
  )
);

-- Las funciones de lectura de cifras pasan a ser de lector_ventas (siguen siendo SECURITY DEFINER: corren como él).
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'ventas'::regnamespace and p.prosecdef
             and p.proname in ('acumulado_anio', 'clientes_lista', 'clientes_resumen', 'descomposicion', 'kpi_periodo',
                               'puente_precio_volumen_mezcla', 'rutas_atipicas', 'serie_mensual', 'top_contribuyentes', 'variacion_por_dimension')
  loop
    execute format('alter function %s owner to lector_ventas', f);
  end loop;
end $$;

/**
 * Listas de la versión (canales, rutas, marcas, productos) recortadas al ámbito: los filtros y el asistente no muestran
 * nombres de rutas o canales de fuera. Marcas y productos no se recortan (no son dimensiones del ámbito).
 */
create or replace function interno.metadatos_en_alcance(m jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select case when interno.alcance_sesion() is null or m is null then m else
    m || jsonb_build_object(
      'canal', coalesce((select jsonb_agg(x) from jsonb_array_elements_text(m -> 'canal') x
                         where interno.alcance_lista('canal') is null or x = any(interno.alcance_lista('canal'))), '[]'::jsonb),
      'ruta', coalesce((select jsonb_agg(x) from jsonb_array_elements_text(m -> 'ruta') x
                        where interno.alcance_lista('ruta') is null or x = any(interno.alcance_lista('ruta'))), '[]'::jsonb))
  end
$$;

create or replace function ventas.version_vigente() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform interno.exigir_acceso();
  v := interno.version_vigente();
  return case when v is null then null else v || jsonb_build_object('metadatos', interno.metadatos_en_alcance(v -> 'metadatos'), 'alcance', interno.alcance_sesion()) end;
end $$;

-- El resumen por correo es de toda la venta: no se manda a quien tiene un ámbito.
create or replace function ventas.correos_equipo() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u.email order by u.email), '{}')
  from public.perfil p join auth.users u on u.id = p.user_id
  where p.activo and p.alcance is null and u.email is not null and u.email <> '';
$$;

grant execute on function interno.alcance_sesion(), interno.alcance_lista(text), interno.metadatos_en_alcance(jsonb) to lector_ventas, service_role;

/** Valores que el admin puede elegir para un ámbito: los de la versión vigente (solo servidor). */
create or replace function ventas.opciones_alcance() returns jsonb
language sql stable set search_path = '' as $$
  with v as (select max(version) v from ventas.publicacion where retirada_en is null),
  r as (select distinct x.empresa, x.canal, x.ruta from ventas.resumen_mensual x
        join ventas.version_mes vm on vm.carga_id = x.carga_id and vm.anio = x.anio and vm.mes = x.mes join v on vm.version = v.v)
  select jsonb_build_object(
    'empresa', (select coalesce(jsonb_agg(distinct empresa order by empresa), '[]') from r),
    'canal', (select coalesce(jsonb_agg(distinct canal order by canal), '[]') from r),
    'ruta', (select coalesce(jsonb_agg(distinct ruta order by ruta), '[]') from r));
$$;
revoke execute on function ventas.opciones_alcance() from public, anon, authenticated;
grant execute on function ventas.opciones_alcance() to service_role;
