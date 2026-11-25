-- Glosario recuperable y documentos en más formatos.
--
-- 1. Glosario del asistente. Hasta ahora las definiciones eran reglas (0011): todas van en las instrucciones de cada
--    pregunta y comparten el tope de 30. El glosario guarda término + sinónimos + definición, y el servidor manda al
--    modelo solo las definiciones cuyos términos aparecen en la pregunta: caben cientos sin alargar cada llamada.
--    Mismo patrón que las reglas: RLS activo, sin acceso para anon/authenticated; lo lee y lo cambia el servidor con
--    service_role después de verificar que quien lo pide es admin con 2FA.
-- 2. Conocimiento: además de PDF se aceptan Word (.docx), Excel (.xlsx) y texto (.txt, .md). `tipo` dice cómo leer
--    el archivo y cómo se nombra la «página» de una cita: página (pdf), hoja (xlsx) o sección (docx, txt, md).

-- 1. Glosario ------------------------------------------------------------------------------------------------------
create table ventas.termino_glosario (
  id uuid primary key default gen_random_uuid(),
  termino text not null check (length(termino) between 2 and 80 and termino !~ '[\r\n]'),
  sinonimos text[] not null default '{}' check (cardinality(sinonimos) <= 20),
  definicion text not null check (length(definicion) between 3 and 500 and definicion !~ '[\r\n]'), -- una línea: va como viñeta en el prompt
  -- Sin tildes ni mayúsculas: «Ticket» y «ticket» son el mismo término. Es la llave al importar un archivo.
  clave text generated always as (conocimiento.normalizar(termino)) stored,
  activo boolean not null default true,
  creado_por uuid references auth.users(id) on delete set null,
  actualizado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index termino_glosario_clave on ventas.termino_glosario (clave);
create index on ventas.termino_glosario (activo, termino);

alter table ventas.termino_glosario enable row level security;
revoke all on ventas.termino_glosario from public, anon, authenticated;
grant all on ventas.termino_glosario to service_role;

-- Tope de términos: el glosario se lee completo en cada pregunta para buscar coincidencias.
create or replace function interno.tope_glosario() returns int language sql immutable as $$ select 1000 $$;

/**
 * Carga un archivo de glosario: crea los términos nuevos y actualiza los que ya existen (misma `clave`). No cambia
 * si están activos. Todo o nada: si el resultado pasa del tope, no se guarda ninguno.
 * p_filas: [{"termino": "...", "sinonimos": ["..."], "definicion": "..."}], ya validadas por el servidor.
 */
create or replace function ventas.importar_glosario(p_filas jsonb, p_usuario uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare v_nuevos int; v_total int;
begin
  lock table ventas.termino_glosario in share row exclusive mode;
  with entrada as (
    -- Si el archivo repite un término, queda la última fila.
    select distinct on (conocimiento.normalizar(trim(f.fila->>'termino')))
      trim(f.fila->>'termino') termino,
      coalesce(array(select jsonb_array_elements_text(f.fila->'sinonimos')), '{}') sinonimos,
      trim(f.fila->>'definicion') definicion
    from jsonb_array_elements(p_filas) with ordinality f(fila, n)
    order by conocimiento.normalizar(trim(f.fila->>'termino')), f.n desc
  ), escrito as (
    insert into ventas.termino_glosario (termino, sinonimos, definicion, creado_por, actualizado_por)
    select termino, sinonimos, definicion, p_usuario, p_usuario from entrada
    on conflict (clave) do update
      set termino = excluded.termino, sinonimos = excluded.sinonimos, definicion = excluded.definicion,
          actualizado_por = p_usuario, actualizado_en = now()
    returning (xmax = 0) nuevo
  )
  select count(*) filter (where nuevo), count(*) into v_nuevos, v_total from escrito;
  if (select count(*) from ventas.termino_glosario) > interno.tope_glosario() then
    raise exception 'El glosario admite hasta % términos. Elimina algunos o reduce el archivo.', interno.tope_glosario();
  end if;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_total - v_nuevos);
end $$;

revoke execute on function ventas.importar_glosario(jsonb, uuid), interno.tope_glosario() from public, anon, authenticated;
grant execute on function ventas.importar_glosario(jsonb, uuid), interno.tope_glosario() to service_role;

-- Bitácora del asistente: ids de los términos del glosario que se enviaron al modelo en cada pregunta (null = antes
-- de esta migración o pregunta respondida sin modelo).
alter table ventas.consulta_asistente add column if not exists glosario uuid[];

-- 2. Documentos en más formatos --------------------------------------------------------------------------------------
alter table conocimiento.documento
  add column tipo text not null default 'pdf' check (tipo in ('pdf', 'docx', 'xlsx', 'txt', 'md'));

update storage.buckets set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown'
] where id = 'conocimiento';

-- Igual que en 0025, con `tipo` en la salida.
create or replace function conocimiento.documentos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_nivel text := interno.exigir_acceso();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'titulo', d.titulo, 'fuente', d.fuente, 'fecha_documento', d.fecha_documento,
      'descripcion', d.descripcion, 'audiencia', d.audiencia, 'paginas', d.paginas, 'creado_en', d.creado_en,
      'propietario', d.propietario, 'vigente_hasta', d.vigente_hasta, 'version', d.version, 'tipo', d.tipo
    ) order by d.fecha_documento desc nulls last, d.creado_en desc)
    from conocimiento.documento d
    where d.estado = 'listo' and (d.vigente_hasta is null or d.vigente_hasta >= interno.hoy_hn()) and interno.ve_audiencia(d.audiencia, v_nivel)
  ), '[]'::jsonb);
end $$;

create or replace function conocimiento.buscar(p_texto text, p_embedding extensions.vector default null, p_limite int default 6)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_nivel text := interno.exigir_acceso();
  v_lex text[] := tsvector_to_array(to_tsvector('spanish'::regconfig, conocimiento.normalizar(coalesce(p_texto, ''))));
  v_q tsquery;
begin
  if cardinality(v_lex) = 0 and p_embedding is null then return '[]'::jsonb; end if;
  if cardinality(v_lex) > 0 then
    v_q := to_tsquery('simple'::regconfig, array_to_string(array(select quote_literal(l) from unnest(v_lex) l), ' | '));
  end if;
  return coalesce((
    with visibles as (
      select d.* from conocimiento.documento d where d.estado = 'listo' and (d.vigente_hasta is null or d.vigente_hasta >= interno.hoy_hn()) and interno.ve_audiencia(d.audiencia, v_nivel)
    ),
    por_texto as (
      select f.id, row_number() over (order by ts_rank_cd(f.tsv, v_q) desc, f.id) r,
             cardinality(array(select unnest(tsvector_to_array(f.tsv)) intersect select unnest(v_lex))) coincidencias
      from conocimiento.fragmento f join visibles v on v.id = f.documento_id
      where v_q is not null and f.tsv @@ v_q and not f.sospechoso
      order by ts_rank_cd(f.tsv, v_q) desc, f.id limit 40
    ),
    por_sentido as (
      select f.id, row_number() over (order by f.embedding operator(extensions.<=>) p_embedding, f.id) r,
             1 - (f.embedding operator(extensions.<=>) p_embedding) similitud
      from conocimiento.fragmento f join visibles v on v.id = f.documento_id
      where p_embedding is not null and f.embedding is not null and not f.sospechoso
      order by f.embedding operator(extensions.<=>) p_embedding, f.id limit 40
    ),
    unidos as (
      select coalesce(t.id, s.id) id, coalesce(1.0 / (60 + t.r), 0) + coalesce(1.0 / (60 + s.r), 0) puntaje,
             coalesce(t.coincidencias, 0) coincidencias, s.similitud
      from por_texto t full join por_sentido s on s.id = t.id
      order by puntaje desc limit greatest(1, least(p_limite, 20))
    )
    select jsonb_agg(jsonb_build_object(
      'fragmento_id', f.id, 'documento_id', v.id, 'titulo', v.titulo, 'fuente', v.fuente, 'fecha_documento', v.fecha_documento,
      'pagina', f.pagina, 'texto', f.texto, 'version', v.version, 'tipo', v.tipo, 'coincidencias', u.coincidencias, 'terminos', cardinality(v_lex),
      'similitud', round(u.similitud::numeric, 4), 'puntaje', round(u.puntaje, 6)
    ) order by u.puntaje desc)
    from unidos u join conocimiento.fragmento f on f.id = u.id join visibles v on v.id = f.documento_id
  ), '[]'::jsonb);
end $$;

grant execute on function conocimiento.documentos(), conocimiento.buscar(text, extensions.vector, int) to authenticated;

notify pgrst, 'reload schema';
