-- G6: conocimiento propio (S17). PDFs autorizados por Insights que el asistente cita como contexto, siempre
-- separado de los hechos del cubo.
-- * Archivo original en Storage privado (bucket conocimiento); texto en fragmentos con búsqueda de texto en
--   español (siempre) y embeddings pgvector (cuando hay modelo de embeddings configurado).
-- * Mismo patrón que ventas (0006): tablas sin acceso directo para anon/authenticated; lectura por funciones que
--   exigen aal2 + perfil activo y filtran por audiencia (estandar = todos, plus = solo Plus).
-- * Altas, procesamiento y retiro van por el servidor (service_role) después de verificar admin.

create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists conocimiento;
grant usage on schema conocimiento to anon, authenticated, service_role;

-- Normalización para la búsqueda: minúsculas y sin tildes (inmutable para poder indexarla).
create or replace function conocimiento.normalizar(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, t))
$$;

create table conocimiento.documento (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(titulo) between 3 and 200),
  fuente text not null check (length(fuente) between 2 and 120),   -- quién lo produjo: Insights BIA, Nielsen, agencia…
  fecha_documento date,
  descripcion text,
  audiencia text not null check (audiencia in ('estandar', 'plus')),
  ruta_archivo text not null unique,                                -- objeto en el bucket conocimiento
  nombre_archivo text not null,
  bytes int,
  sha256 text,
  paginas int,
  fragmentos int not null default 0,
  modelo_embedding text,                                            -- null = solo búsqueda de texto
  estado text not null default 'subiendo' check (estado in ('subiendo', 'procesando', 'listo', 'error', 'retirado')),
  error text,
  subido_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  procesado_en timestamptz,
  retirado_en timestamptz
);
create index on conocimiento.documento (estado, creado_en desc);
-- El mismo archivo no se indexa dos veces mientras esté vigente.
create unique index documento_sha_vigente on conocimiento.documento (sha256) where estado in ('procesando', 'listo');

create table conocimiento.fragmento (
  id bigint generated always as identity primary key,
  documento_id uuid not null references conocimiento.documento(id) on delete cascade,
  orden int not null,
  pagina int not null,
  texto text not null,
  tsv tsvector generated always as (to_tsvector('spanish'::regconfig, conocimiento.normalizar(texto))) stored,
  embedding extensions.vector(1024),
  unique (documento_id, orden)
);
create index on conocimiento.fragmento using gin (tsv);
create index on conocimiento.fragmento using hnsw (embedding extensions.vector_cosine_ops);

alter table conocimiento.documento enable row level security;
alter table conocimiento.fragmento enable row level security;
revoke all on all tables in schema conocimiento from anon, authenticated;
grant all on all tables in schema conocimiento to service_role;
grant all on all sequences in schema conocimiento to service_role;

-- Lectura ------------------------------------------------------------------------------------------------------
create or replace function interno.ve_audiencia(p_audiencia text, p_nivel text) returns boolean
language sql immutable set search_path = '' as $$
  select p_audiencia = 'estandar' or p_nivel in ('plus', 'servicio')
$$;

/** Documentos vigentes que la persona puede ver (pantalla Conocimiento). */
create or replace function conocimiento.documentos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_nivel text := interno.exigir_acceso();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'titulo', d.titulo, 'fuente', d.fuente, 'fecha_documento', d.fecha_documento,
      'descripcion', d.descripcion, 'audiencia', d.audiencia, 'paginas', d.paginas, 'creado_en', d.creado_en
    ) order by d.fecha_documento desc nulls last, d.creado_en desc)
    from conocimiento.documento d
    where d.estado = 'listo' and interno.ve_audiencia(d.audiencia, v_nivel)
  ), '[]'::jsonb);
end $$;

/** Ruta del PDF si la persona puede verlo (para firmar la descarga en el servidor); null si no. */
create or replace function conocimiento.ruta_visible(p_documento uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_nivel text := interno.exigir_acceso();
begin
  return (select d.ruta_archivo from conocimiento.documento d
          where d.id = p_documento and d.estado = 'listo' and interno.ve_audiencia(d.audiencia, v_nivel));
end $$;

/**
 * Búsqueda híbrida: texto en español (lexemas de la pregunta unidos con OR) y, si viene p_embedding, cercanía
 * semántica; se combinan con Reciprocal Rank Fusion (k = 60). `coincidencias` = lexemas distintos de la pregunta
 * presentes en el fragmento; la app decide con eso y con `similitud` qué es relevante.
 */
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
      select d.* from conocimiento.documento d where d.estado = 'listo' and interno.ve_audiencia(d.audiencia, v_nivel)
    ),
    por_texto as (
      select f.id, row_number() over (order by ts_rank_cd(f.tsv, v_q) desc, f.id) r,
             cardinality(array(select unnest(tsvector_to_array(f.tsv)) intersect select unnest(v_lex))) coincidencias
      from conocimiento.fragmento f join visibles v on v.id = f.documento_id
      where v_q is not null and f.tsv @@ v_q
      order by ts_rank_cd(f.tsv, v_q) desc, f.id limit 40
    ),
    por_sentido as (
      select f.id, row_number() over (order by f.embedding operator(extensions.<=>) p_embedding, f.id) r,
             1 - (f.embedding operator(extensions.<=>) p_embedding) similitud
      from conocimiento.fragmento f join visibles v on v.id = f.documento_id
      where p_embedding is not null and f.embedding is not null
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
      'pagina', f.pagina, 'texto', f.texto, 'coincidencias', u.coincidencias, 'terminos', cardinality(v_lex),
      'similitud', round(u.similitud::numeric, 4), 'puntaje', round(u.puntaje, 6)
    ) order by u.puntaje desc)
    from unidos u join conocimiento.fragmento f on f.id = u.id join visibles v on v.id = f.documento_id
  ), '[]'::jsonb);
end $$;

revoke execute on all functions in schema conocimiento from public, anon, authenticated;
alter default privileges in schema conocimiento revoke execute on functions from public;
grant execute on function conocimiento.documentos(), conocimiento.ruta_visible(uuid),
  conocimiento.buscar(text, extensions.vector, int) to authenticated;
grant execute on all functions in schema conocimiento to service_role;
revoke execute on function interno.ve_audiencia(text, text) from public, anon, authenticated;

-- Storage: bucket privado, solo PDF hasta 20 MB. Sin políticas: el navegador sube con una URL firmada que crea
-- el servidor (admin) y descarga con una URL firmada de 5 minutos tras revisar la audiencia.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conocimiento', 'conocimiento', false, 20 * 1024 * 1024, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
