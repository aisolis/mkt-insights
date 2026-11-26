-- Orden de la búsqueda de documentos: primero los fragmentos que comparten más términos distintos con la pregunta.
--
-- La parte de texto de conocimiento.buscar ordenaba solo por ts_rank_cd, que premia repetir un término. Con pocos
-- documentos no se notaba; al cargar los estudios reales (unos 600 fragmentos donde «café» aparece en casi todos),
-- un fragmento que repite «café» le ganaba al que habla de lo que se preguntó, y este quedaba fuera de los 40
-- candidatos: la app nunca llegaba a verlo, aunque su criterio de relevancia (2 términos en común) lo habría aceptado.
-- Ahora, como en ventas.buscar_adjuntos (0031): más términos distintos en común primero y, entre iguales, el rango de
-- texto. La parte semántica y la fusión (RRF) no cambian. Misma firma y misma salida que en 0030.

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
      select x.id, row_number() over (order by x.coincidencias desc, x.rango desc, x.id) r, x.coincidencias
      from (
        select f.id, ts_rank_cd(f.tsv, v_q) rango,
               cardinality(array(select unnest(tsvector_to_array(f.tsv)) intersect select unnest(v_lex))) coincidencias
        from conocimiento.fragmento f join visibles v on v.id = f.documento_id
        where v_q is not null and f.tsv @@ v_q and not f.sospechoso
      ) x
      order by x.coincidencias desc, x.rango desc, x.id limit 40
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

grant execute on function conocimiento.buscar(text, extensions.vector, int) to authenticated;

notify pgrst, 'reload schema';
