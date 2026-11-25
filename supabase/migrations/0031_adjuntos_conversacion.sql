-- Adjuntos de una conversación del asistente: archivos o fotos que la persona sube para hablar de ellos junto con
-- los datos de venta. Son contexto variable, distinto del conocimiento autorizado (0007):
-- * Viven en una conversación y son de quien los subió: nadie más los ve ni se usan en otra conversación.
-- * No son hechos del cubo ni documentos autorizados: el asistente los cita aparte ([a1]).
-- * Un adjunto corto va entero al modelo (`texto`); uno largo se busca por fragmentos, igual que el conocimiento.
-- * Una foto se lee una vez con un modelo de visión y queda como texto; ese costo cuenta para el tope del mes.
-- Mismo patrón que la bitácora del servidor (0012): tablas sin acceso para anon/authenticated. El servidor comprueba
-- con la sesión del usuario (RLS) que la conversación es suya y después lee y escribe con service_role.

create table ventas.adjunto (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references ventas.conversacion(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null check (length(nombre) between 1 and 200),
  tipo text not null check (tipo in ('pdf', 'docx', 'xlsx', 'txt', 'md', 'imagen')),
  ruta_archivo text not null unique,                       -- objeto en el bucket adjuntos
  bytes int,
  sha256 text,
  -- `quitado`: la persona lo quitó; se borran archivo, texto y fragmentos, y queda la fila por el costo y la auditoría.
  estado text not null default 'subiendo' check (estado in ('subiendo', 'procesando', 'listo', 'error', 'quitado')),
  error text,
  paginas int,
  fragmentos int not null default 0,
  caracteres int,
  texto text,                                              -- texto completo si es corto (va entero al modelo); null si no
  modelo_embedding text,
  modelo_vision text,                                      -- solo fotos
  tokens_entrada int,
  tokens_salida int,
  costo_usd numeric(12, 8),                                -- lectura de la foto
  creado_en timestamptz not null default now(),
  procesado_en timestamptz
);
create index on ventas.adjunto (conversacion_id, creado_en);
create index on ventas.adjunto (creado_en) where costo_usd is not null;

create table ventas.adjunto_fragmento (
  id bigint generated always as identity primary key,
  adjunto_id uuid not null references ventas.adjunto(id) on delete cascade,
  orden int not null,
  pagina int not null,
  texto text not null,
  tsv tsvector generated always as (to_tsvector('spanish'::regconfig, conocimiento.normalizar(texto))) stored,
  embedding extensions.vector(1024),
  sospechoso boolean not null default false,               -- parece instrucciones para la IA: nunca se recupera
  unique (adjunto_id, orden)
);
create index on ventas.adjunto_fragmento using gin (tsv);
-- Sin índice vectorial: la búsqueda siempre es dentro de una conversación (pocos fragmentos), se recorre directo.

alter table ventas.adjunto enable row level security;
alter table ventas.adjunto_fragmento enable row level security;
revoke all on ventas.adjunto, ventas.adjunto_fragmento from public, anon, authenticated;
grant all on ventas.adjunto, ventas.adjunto_fragmento to service_role;
grant usage, select on sequence ventas.adjunto_fragmento_id_seq to service_role;

-- Bitácora del asistente: ids de los adjuntos disponibles al responder cada pregunta (null = antes de esta migración).
alter table ventas.consulta_asistente add column if not exists adjuntos uuid[];

/**
 * Búsqueda híbrida en los adjuntos de UNA conversación de UNA persona (misma fusión que conocimiento.buscar).
 * Solo service_role: el servidor ya comprobó con la sesión del usuario que la conversación es suya, y aun así se
 * filtra por p_usuario.
 */
create or replace function ventas.buscar_adjuntos(p_conversacion uuid, p_usuario uuid, p_texto text, p_embedding extensions.vector default null, p_limite int default 6)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_lex text[] := tsvector_to_array(to_tsvector('spanish'::regconfig, conocimiento.normalizar(coalesce(p_texto, ''))));
  v_q tsquery;
begin
  if cardinality(v_lex) = 0 and p_embedding is null then return '[]'::jsonb; end if;
  if cardinality(v_lex) > 0 then
    v_q := to_tsquery('simple'::regconfig, array_to_string(array(select quote_literal(l) from unnest(v_lex) l), ' | '));
  end if;
  return coalesce((
    with propios as (
      select a.id, a.nombre, a.tipo from ventas.adjunto a
      where a.conversacion_id = p_conversacion and a.usuario_id = p_usuario and a.estado = 'listo'
    ),
    -- Primero los fragmentos que comparten más términos distintos con la pregunta y, entre iguales, el rango de
    -- texto: así un adjunto que repite mucho una palabra no le gana al que habla de lo que se preguntó.
    por_texto as (
      select x.id, row_number() over (order by x.coincidencias desc, x.rango desc, x.id) r, x.coincidencias
      from (
        select f.id, ts_rank_cd(f.tsv, v_q) rango,
               cardinality(array(select unnest(tsvector_to_array(f.tsv)) intersect select unnest(v_lex))) coincidencias
        from ventas.adjunto_fragmento f join propios p on p.id = f.adjunto_id
        where v_q is not null and f.tsv @@ v_q and not f.sospechoso
      ) x
      order by x.coincidencias desc, x.rango desc, x.id limit 40
    ),
    por_sentido as (
      select f.id, row_number() over (order by f.embedding operator(extensions.<=>) p_embedding, f.id) r,
             1 - (f.embedding operator(extensions.<=>) p_embedding) similitud
      from ventas.adjunto_fragmento f join propios p on p.id = f.adjunto_id
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
      'fragmento_id', f.id, 'adjunto_id', p.id, 'nombre', p.nombre, 'tipo', p.tipo, 'pagina', f.pagina, 'texto', f.texto,
      'coincidencias', u.coincidencias, 'terminos', cardinality(v_lex),
      'similitud', round(u.similitud::numeric, 4), 'puntaje', round(u.puntaje, 6)
    ) order by u.puntaje desc)
    from unidos u join ventas.adjunto_fragmento f on f.id = u.id join propios p on p.id = f.adjunto_id
  ), '[]'::jsonb);
end $$;
revoke execute on function ventas.buscar_adjuntos(uuid, uuid, text, extensions.vector, int) from public, anon, authenticated;
grant execute on function ventas.buscar_adjuntos(uuid, uuid, text, extensions.vector, int) to service_role;

-- Gasto del mes: suma también la lectura de fotos, para que el tope mensual las cubra. Mismas llaves que en 0017,
-- más adjuntos_usd y adjuntos.
create or replace function ventas.gasto_asistente_mes()
returns jsonb language sql stable set search_path = '' as $$
  with desde as (
    select (date_trunc('month', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa') as d
  ), c as (
    select coalesce(sum(costo_usd), 0) as costo, count(*) filter (where costo_usd is not null) as n
    from ventas.consulta_asistente, desde where creado_en >= desde.d
  ), p as (
    select coalesce(sum(costo_usd), 0) as costo, count(*) as n from ventas.prueba_modelo, desde where creado_en >= desde.d
  ), a as (
    select coalesce(sum(costo_usd), 0) as costo, count(*) filter (where costo_usd is not null) as n
    from ventas.adjunto, desde where creado_en >= desde.d
  )
  select jsonb_build_object('desde', desde.d, 'total_usd', c.costo + p.costo + a.costo, 'preguntas_usd', c.costo,
    'preguntas', c.n, 'pruebas_usd', p.costo, 'pruebas', p.n, 'adjuntos_usd', a.costo, 'adjuntos', a.n)
  from desde, c, p, a
$$;
revoke execute on function ventas.gasto_asistente_mes() from public, anon, authenticated;
grant execute on function ventas.gasto_asistente_mes() to service_role;

-- Storage: bucket privado, hasta 10 MB. Sin políticas: el navegador sube con una URL firmada que crea el servidor
-- después de comprobar que la conversación es de la persona; nadie descarga desde el navegador.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adjuntos', 'adjuntos', false, 10 * 1024 * 1024, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
