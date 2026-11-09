-- G11 (V1-06, S28): control independiente de BI. BI entrega un reporte propio (venta neta y/o kg por mes, y si quiere por
-- empresa y/o canal) generado fuera de Foresight. Se guarda el original con su huella, custodio y corte, se compara con
-- la carga al mismo nivel y se muestra cada diferencia. "Conciliada con BI" ya no se marca con una nota: la pone la
-- base cuando el control coincide en todas sus cifras, cubre los mismos meses y el último mes se declaró completo.
-- La regla de igualdad es exacta después de redondear al número de decimales que declara quien sube el control.

create table ventas.control_bi (
  id bigint generated always as identity primary key,
  carga_id uuid not null references ventas.carga(id) on delete cascade,
  nombre_archivo text not null,
  ruta_archivo text not null,
  sha256 text not null,
  custodio text not null check (length(custodio) between 3 and 120),   -- quién en BI generó el reporte
  fecha_corte date not null,                                           -- corte de datos del reporte de BI
  nota text,
  nivel text[] not null check (nivel <@ array['empresa', 'canal']),    -- {} = total por mes
  medidas text[] not null check (cardinality(medidas) > 0 and medidas <@ array['venta_neta', 'kg']),
  decimales_venta smallint not null default 2 check (decimales_venta between 0 and 2),
  decimales_kg smallint not null default 2 check (decimales_kg between 0 and 4),
  filas int not null,
  subido_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  anulado_en timestamptz
);
create index control_bi_carga on ventas.control_bi (carga_id, id desc);
create table ventas.control_bi_fila (
  control_id bigint not null references ventas.control_bi(id) on delete cascade,
  anio smallint not null, mes smallint not null check (mes between 1 and 12),
  empresa text, canal text,
  venta_neta numeric(18,2), kg numeric(18,4)
);
create index control_bi_fila_control on ventas.control_bi_fila (control_id);
alter table ventas.control_bi enable row level security;
alter table ventas.control_bi_fila enable row level security;
grant all on ventas.control_bi, ventas.control_bi_fila to service_role;

alter table ventas.publicacion add column control_bi_id bigint references ventas.control_bi(id);

/**
 * Compara un control con su carga al nivel del control (mes, y empresa y/o canal si los trae). Empresa y canal se
 * emparejan sin distinguir mayúsculas, tildes ni signos. Dentro de los meses que cubren los dos, una clave que falta de
 * un lado vale cero (una fila de BI en 0.00 equivale a no tener ventas); un mes que está en un solo lado es diferencia.
 */
create or replace function ventas.comparar_control(p_control bigint) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  k ventas.control_bi;
  r jsonb;
begin
  select * into k from ventas.control_bi where id = p_control;
  if not found then raise exception 'el control % no existe', p_control; end if;
  with nuestro as (
    select x.anio, x.mes,
      case when 'empresa' = any(k.nivel) then interno._normalizar_encabezado(x.empresa) end ek,
      case when 'canal' = any(k.nivel) then interno._normalizar_encabezado(x.canal) end ck,
      min(x.empresa) empresa, min(x.canal) canal, sum(x.venta_neta) v, sum(x.kg) kg
    from ventas.resumen_mensual x where x.carga_id = k.carga_id group by 1, 2, 3, 4
  ), bi as (
    select f.anio, f.mes,
      case when 'empresa' = any(k.nivel) then interno._normalizar_encabezado(f.empresa) end ek,
      case when 'canal' = any(k.nivel) then interno._normalizar_encabezado(f.canal) end ck,
      f.empresa, f.canal, f.venta_neta v, f.kg
    from ventas.control_bi_fila f where f.control_id = p_control
  ), meses_n as (select distinct anio, mes from nuestro), meses_b as (select distinct anio, mes from bi),
  meses as (
    select coalesce(a.anio, b.anio) anio, coalesce(a.mes, b.mes) mes, a.anio is not null en_foresight, b.anio is not null en_bi
    from meses_n a full join meses_b b on a.anio = b.anio and a.mes = b.mes
  ), cmp as (
    select coalesce(n.anio, b.anio) anio, coalesce(n.mes, b.mes) mes,
      case when 'empresa' = any(k.nivel) then coalesce(b.empresa, n.empresa) end empresa,
      case when 'canal' = any(k.nivel) then coalesce(b.canal, n.canal) end canal,
      round(coalesce(n.v, 0), k.decimales_venta) fv, round(coalesce(b.v, 0), k.decimales_venta) bv,
      round(coalesce(n.kg, 0), k.decimales_kg) fk, round(coalesce(b.kg, 0), k.decimales_kg) bk
    from nuestro n full join bi b on n.anio = b.anio and n.mes = b.mes and n.ek is not distinct from b.ek and n.ck is not distinct from b.ck
    join meses m on m.anio = coalesce(n.anio, b.anio) and m.mes = coalesce(n.mes, b.mes) and m.en_foresight and m.en_bi
  ), marcado as (
    select c.*, (not 'venta_neta' = any(k.medidas) or c.fv = c.bv) and (not 'kg' = any(k.medidas) or c.fk = c.bk) igual from cmp c
  )
  select jsonb_build_object(
    'cifras', (select count(*) from marcado),
    'iguales', (select count(*) filter (where igual) from marcado),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object('anio', anio, 'mes', mes, 'en_foresight', en_foresight, 'en_bi', en_bi) order by anio, mes), '[]') from meses),
    'diferencias', (select coalesce(jsonb_agg(d.j order by d.anio, d.mes, d.empresa, d.canal), '[]') from (
      select anio, mes, empresa, canal, jsonb_build_object('anio', anio, 'mes', mes, 'empresa', empresa, 'canal', canal,
        'venta_foresight', fv, 'venta_bi', bv, 'kg_foresight', fk, 'kg_bi', bk) j
      from marcado where not igual order by anio, mes, empresa, canal limit 200) d),
    'total_diferencias', (select count(*) filter (where not igual) from marcado)
  ) into r;
  return r || jsonb_build_object('coincide',
    (r->>'cifras')::int > 0 and (r->>'total_diferencias')::int = 0
    and not exists (select 1 from jsonb_array_elements(r->'meses') m where not (m->>'en_foresight')::boolean or not (m->>'en_bi')::boolean));
end $$;

/** Último control sin anular de cada carga, con quién lo subió y la comparación de ahora. */
create or replace function ventas.controles(p_cargas uuid[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id, 'carga_id', k.carga_id, 'nombre_archivo', k.nombre_archivo, 'custodio', k.custodio, 'fecha_corte', k.fecha_corte,
    'nota', k.nota, 'nivel', k.nivel, 'medidas', k.medidas, 'decimales_venta', k.decimales_venta, 'decimales_kg', k.decimales_kg,
    'filas', k.filas, 'subido_por', pe.nombre, 'creado_en', k.creado_en, 'resultado', ventas.comparar_control(k.id))), '[]'::jsonb)
  from (select distinct on (x.carga_id) x.* from ventas.control_bi x
        where x.carga_id = any(p_cargas) and x.anulado_en is null order by x.carga_id, x.id desc) k
  left join public.perfil pe on pe.user_id = k.subido_por;
$$;

/** Guarda un control ya leído (filas en JSON) y anula el anterior de la misma carga. */
create or replace function ventas.guardar_control(p_carga uuid, p_meta jsonb, p_filas jsonb, p_usuario uuid) returns bigint
language plpgsql set search_path = '' as $$
declare
  nuevo bigint;
  estado text;
begin
  select c.estado into estado from ventas.carga c where c.id = p_carga for update;
  if not found then raise exception 'la carga no existe'; end if;
  if estado not in ('validada', 'publicada') then raise exception 'el control de BI se sube para una carga lista para publicar o publicada'; end if;
  update ventas.control_bi set anulado_en = now() where carga_id = p_carga and anulado_en is null;
  insert into ventas.control_bi (carga_id, nombre_archivo, ruta_archivo, sha256, custodio, fecha_corte, nota, nivel, medidas, decimales_kg, filas, subido_por)
  values (p_carga, p_meta->>'nombre_archivo', p_meta->>'ruta_archivo', p_meta->>'sha256', trim(p_meta->>'custodio'), (p_meta->>'fecha_corte')::date,
          nullif(trim(p_meta->>'nota'), ''), array(select jsonb_array_elements_text(p_meta->'nivel')), array(select jsonb_array_elements_text(p_meta->'medidas')),
          coalesce((p_meta->>'decimales_kg')::smallint, 2), jsonb_array_length(p_filas), p_usuario)
  returning id into nuevo;
  insert into ventas.control_bi_fila (control_id, anio, mes, empresa, canal, venta_neta, kg)
  select nuevo, (f->>'anio')::smallint, (f->>'mes')::smallint, f->>'empresa', f->>'canal', (f->>'venta_neta')::numeric, (f->>'kg')::numeric
  from jsonb_array_elements(p_filas) f;
  return nuevo;
end $$;

/**
 * Sello "conciliada con BI" de una versión publicada: solo si el último control de su carga coincide en todo y el último
 * mes se publicó como completo. Guarda contra qué control se concilió. Devuelve {sellada, motivo}.
 */
create or replace function ventas.sellar_con_control(p_version int) returns jsonb
language plpgsql set search_path = '' as $$
declare
  p ventas.publicacion;
  k ventas.control_bi;
  r jsonb;
  meses text;
begin
  select * into p from ventas.publicacion where version = p_version for update;
  if not found then raise exception 'la versión % no existe', p_version; end if;
  if p.conciliada_bi then return jsonb_build_object('sellada', true, 'motivo', 'ya estaba conciliada'); end if;
  if p.retirada_en is not null then return jsonb_build_object('sellada', false, 'motivo', 'la versión está retirada'); end if;
  select * into k from ventas.control_bi where carga_id = p.carga_id and anulado_en is null order by id desc limit 1;
  if not found then return jsonb_build_object('sellada', false, 'motivo', 'no hay control de BI'); end if;
  r := ventas.comparar_control(k.id);
  if not (r->>'coincide')::boolean then return jsonb_build_object('sellada', false, 'motivo', 'el control de BI no coincide'); end if;
  if not p.ultimo_mes_cerrado then return jsonb_build_object('sellada', false, 'motivo', 'el último mes se publicó como parcial'); end if;
  select string_agg(to_char(make_date((m->>'anio')::int, (m->>'mes')::int, 1), 'YYYY-MM'), ', ') into meses from jsonb_array_elements(r->'meses') m;
  update ventas.publicacion set conciliada_bi = true, conciliada_en = now(), conciliada_por = k.subido_por, control_bi_id = k.id,
    conciliada_nota = format('Control de BI «%s» de %s, corte %s: %s cifras iguales (%s%s%s)', k.nombre_archivo, k.custodio,
      to_char(k.fecha_corte, 'DD-MM-YYYY'), r->>'cifras', meses,
      case when cardinality(k.nivel) > 0 then ' por ' || array_to_string(k.nivel, ' y ') else '' end,
      case when k.medidas = array['venta_neta', 'kg'] or k.medidas = array['kg', 'venta_neta'] then '; venta neta y kg' when 'kg' = any(k.medidas) then '; kg' else '; venta neta' end)
  where version = p_version;
  return jsonb_build_object('sellada', true, 'motivo', null);
end $$;

-- La aprobación también cubre el control de BI con el que se aprobó.
create or replace function ventas.huella_carga(p_carga uuid) returns text
language sql stable set search_path = '' as $$
  select md5(concat_ws('|',
    (select c.sha256 from ventas.carga c where c.id = p_carga),
    (select coalesce(max(p.version)::text, '-') from ventas.publicacion p where p.retirada_en is null),
    (select coalesce(string_agg(concat_ws(':', m.anio, m.mes, m.filas, m.venta_neta, m.kg, m.ultimo_dia, m.duplicados, m.discrepancias,
              array_to_string(m.canales_sin_homologar, ',')), ';' order by m.anio, m.mes), '')
       from ventas.carga_mes m where m.carga_id = p_carga),
    (select coalesce(string_agg(concat_ws(':', x.anio, x.mes, x.empresa, x.canal, x.v, x.k), ';' order by x.anio, x.mes, x.empresa, x.canal), '')
       from (select r.anio, r.mes, r.empresa, r.canal, sum(r.venta_neta) v, sum(r.kg) k
             from ventas.resumen_mensual r where r.carga_id = p_carga group by 1, 2, 3, 4) x),
    (select coalesce(max(k.id)::text, 'sin-control') from ventas.control_bi k where k.carga_id = p_carga and k.anulado_en is null)
  ));
$$;

-- Ya no se concilia con una nota escrita a mano (V1-06).
drop function if exists ventas.marcar_conciliada(int, text, uuid);


-- publicar: igual que en 0020, más el sello con el control de BI al final.
create or replace function ventas.publicar(p_carga uuid, p_notas text default null, p_usuario uuid default null, p_rol text default 'servicio')
returns jsonb language plpgsql set statement_timeout = '10min' as $$
declare
  c ventas.carga;
  a ventas.aprobacion_carga;
  v int;
  vig int;
  reemplazos jsonb;
  corte date;
  sello jsonb;
begin
  select * into c from ventas.carga where id = p_carga for update;
  if not found then raise exception 'la carga % no existe', p_carga; end if;
  if c.estado <> 'validada' then raise exception 'la carga % está en estado "%", no "validada"', p_carga, c.estado; end if;
  if not exists (select 1 from ventas.carga_mes where carga_id = p_carga) then raise exception 'la carga % no tiene filas', p_carga; end if;
  lock table ventas.publicacion in exclusive mode; -- dos publicaciones simultáneas no pueden tomar el mismo número
  select * into a from ventas.aprobacion_carga where carga_id = p_carga and anulada_en is null order by id desc limit 1;
  if not found then raise exception 'la carga no está aprobada: apruébala antes de publicar'; end if;
  if a.huella <> ventas.huella_carga(p_carga) then
    raise exception 'la carga cambió desde que se aprobó (homologación, control de BI u otra versión publicada): vuelve a aprobarla';
  end if;
  select coalesce(max(version), 0) + 1 into v from ventas.publicacion;
  select version into vig from ventas.publicacion where retirada_en is null order by version desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('anio', cm.anio, 'mes', cm.mes, 'carga_anterior', vm.carga_id) order by cm.anio, cm.mes)
                  filter (where vm.carga_id is not null), '[]'::jsonb)
  into reemplazos
  from ventas.carga_mes cm left join ventas.version_mes vm on vm.version = vig and vm.anio = cm.anio and vm.mes = cm.mes
  where cm.carga_id = p_carga;

  insert into ventas.publicacion (version, carga_id, fecha_corte, conciliada_bi, notas, aprobado_por, ultimo_mes_cerrado, meses_reemplazados,
                                  aprobacion_id, publicado_por, rol_publicacion)
  values (v, p_carga, c.periodo_hasta, false, p_notas, a.usuario_id, a.ultimo_mes_cerrado, reemplazos, a.id, p_usuario, p_rol);
  insert into ventas.version_mes (version, anio, mes, carga_id)
  select v, vm.anio, vm.mes, vm.carga_id from ventas.version_mes vm
  where vm.version = vig and not exists (select 1 from ventas.carga_mes cm where cm.carga_id = p_carga and cm.anio = vm.anio and cm.mes = vm.mes);
  insert into ventas.version_mes (version, anio, mes, carga_id) select v, anio, mes, p_carga from ventas.carga_mes where carga_id = p_carga;

  select max(cm.ultimo_dia) into corte from ventas.version_mes vm
  join ventas.carga_mes cm on cm.carga_id = vm.carga_id and cm.anio = vm.anio and cm.mes = vm.mes where vm.version = v;
  update ventas.publicacion set fecha_corte = corte, metadatos = ventas._metadatos_version(v, a.ultimo_mes_cerrado) where version = v;
  update ventas.carga set estado = 'publicada' where id = p_carga;
  sello := ventas.sellar_con_control(v); -- conciliada con BI solo si el control de la carga coincide (V1-06)
  return jsonb_build_object('version', v, 'carga', p_carga, 'archivo', c.nombre_archivo, 'fecha_corte', corte, 'meses_reemplazados', reemplazos,
    'conciliada_bi', (sello->>'sellada')::boolean, 'motivo_sin_conciliar', sello->>'motivo');
end $$;

revoke execute on function ventas.comparar_control(bigint), ventas.controles(uuid[]), ventas.guardar_control(uuid, jsonb, jsonb, uuid), ventas.sellar_con_control(int), ventas.huella_carga(uuid), ventas.publicar(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function ventas.comparar_control(bigint), ventas.controles(uuid[]), ventas.guardar_control(uuid, jsonb, jsonb, uuid), ventas.sellar_con_control(int), ventas.huella_carga(uuid), ventas.publicar(uuid, text, uuid, text) to service_role;

-- Originales de los reportes de BI (evidencia del control), privados; solo el servidor los escribe y los lee.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('controles-bi', 'controles-bi', false, 1048576, array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
