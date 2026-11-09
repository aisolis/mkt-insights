-- G11 (V1-16, S32): documentos con dueño, derechos de uso, vigencia y versión. Un documento nuevo puede sustituir a
-- otro (queda como su versión siguiente y el anterior se retira con el motivo). Vencido o retirado no se lista, no se
-- abre y no se recupera para el asistente. Los fragmentos con texto que parece instrucciones para la IA se marcan al
-- procesar y nunca se recuperan (defensa contra instrucciones escondidas en un PDF); el admin ve cuántos hay.

alter table conocimiento.documento
  add column propietario text check (propietario is null or length(propietario) between 2 and 120),  -- dueño en BIA
  add column derechos text check (derechos is null or length(derechos) between 3 and 300),          -- de quién es y qué uso permite
  add column vigente_hasta date,                                                                     -- null = sin vencimiento
  add column version int not null default 1,
  add column sustituye_a uuid references conocimiento.documento(id) on delete set null,
  add column motivo_retiro text,
  add column fragmentos_sospechosos int not null default 0;
alter table conocimiento.fragmento add column sospechoso boolean not null default false;

/** Hoy en Honduras (las vigencias son fechas civiles). */
create or replace function interno.hoy_hn() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
grant execute on function interno.hoy_hn() to authenticated, service_role;

create or replace function conocimiento.documentos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_nivel text := interno.exigir_acceso();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'titulo', d.titulo, 'fuente', d.fuente, 'fecha_documento', d.fecha_documento,
      'descripcion', d.descripcion, 'audiencia', d.audiencia, 'paginas', d.paginas, 'creado_en', d.creado_en,
      'propietario', d.propietario, 'vigente_hasta', d.vigente_hasta, 'version', d.version
    ) order by d.fecha_documento desc nulls last, d.creado_en desc)
    from conocimiento.documento d
    where d.estado = 'listo' and (d.vigente_hasta is null or d.vigente_hasta >= interno.hoy_hn()) and interno.ve_audiencia(d.audiencia, v_nivel)
  ), '[]'::jsonb);
end $$;

create or replace function conocimiento.ruta_visible(p_documento uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_nivel text := interno.exigir_acceso();
begin
  return (select d.ruta_archivo from conocimiento.documento d
          where d.id = p_documento and d.estado = 'listo' and (d.vigente_hasta is null or d.vigente_hasta >= interno.hoy_hn()) and interno.ve_audiencia(d.audiencia, v_nivel));
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
      'pagina', f.pagina, 'texto', f.texto, 'version', v.version, 'coincidencias', u.coincidencias, 'terminos', cardinality(v_lex),
      'similitud', round(u.similitud::numeric, 4), 'puntaje', round(u.puntaje, 6)
    ) order by u.puntaje desc)
    from unidos u join conocimiento.fragmento f on f.id = u.id join visibles v on v.id = f.documento_id
  ), '[]'::jsonb);
end $$;

grant execute on function conocimiento.documentos(), conocimiento.ruta_visible(uuid), conocimiento.buscar(text, extensions.vector, int) to authenticated;
