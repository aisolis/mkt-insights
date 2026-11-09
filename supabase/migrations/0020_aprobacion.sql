-- G11 (V1-07, S27): aprobar y publicar son dos pasos. La aprobación queda sobre una huella del estado exacto de la carga
-- (archivo, totales por mes, totales por empresa y canal ya homologados y la versión vigente contra la que se revisó).
-- Si algo de eso cambia (otra homologación, otra versión publicada), la aprobación deja de valer y hay que volver a
-- aprobar. Cada paso guarda quién, con qué rol y cuándo; una misma persona puede hacer los dos mientras BIA no nombre
-- titulares (Q15).

create table ventas.aprobacion_carga (
  id bigint generated always as identity primary key,
  carga_id uuid not null references ventas.carga(id) on delete cascade,
  usuario_id uuid references auth.users(id) on delete set null,
  rol text not null check (rol in ('admin', 'aprobador', 'servicio')),
  huella text not null,
  ultimo_mes_cerrado boolean not null,
  alertas jsonb not null default '[]',   -- las alertas «Revisar» aceptadas, con el texto que se mostró
  motivo text,                            -- por qué se aceptan: obligatorio si hay alertas «Revisar»
  creado_en timestamptz not null default now(),
  anulada_en timestamptz,
  anulada_por uuid references auth.users(id) on delete set null,
  motivo_anulacion text
);
create index aprobacion_carga_carga on ventas.aprobacion_carga (carga_id, id desc);
alter table ventas.aprobacion_carga enable row level security;
grant all on ventas.aprobacion_carga to service_role;

alter table ventas.publicacion
  add column aprobacion_id bigint references ventas.aprobacion_carga(id),
  add column publicado_por uuid references auth.users(id) on delete set null,
  add column rol_publicacion text check (rol_publicacion in ('admin', 'aprobador', 'servicio'));
-- Antes de G11 aprobado_por guardaba a quien publicó (era un solo paso).
update ventas.publicacion set publicado_por = aprobado_por where aprobacion_id is null and publicado_por is null;

/** Huella de lo que se aprueba. Cambia si cambia el archivo, sus totales, la homologación aplicada o la versión vigente. */
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
             from ventas.resumen_mensual r where r.carga_id = p_carga group by 1, 2, 3, 4) x)
  ));
$$;

create or replace function ventas.aprobar_carga(p_carga uuid, p_usuario uuid, p_rol text, p_ultimo_mes_cerrado boolean,
  p_alertas jsonb default '[]', p_motivo text default null, p_huella text default null) returns bigint
language plpgsql set search_path = '' as $$
declare
  c ventas.carga;
  nueva bigint;
begin
  select * into c from ventas.carga where id = p_carga for update;
  if not found then raise exception 'la carga no existe'; end if;
  if c.estado <> 'validada' then raise exception 'solo se aprueba una carga lista para publicar (esta está "%")', c.estado; end if;
  -- p_huella: la huella con la que se calcularon las alertas que se aceptan; si cambió entretanto, se vuelve a revisar.
  if p_huella is not null and p_huella <> ventas.huella_carga(p_carga) then
    raise exception 'la carga cambió mientras se revisaba: vuelve a revisar las alertas';
  end if;
  if jsonb_array_length(coalesce(p_alertas, '[]')) > 0 and coalesce(length(trim(p_motivo)), 0) < 10 then
    raise exception 'aceptar alertas «Revisar» necesita un motivo de al menos 10 caracteres';
  end if;
  update ventas.aprobacion_carga set anulada_en = now(), anulada_por = p_usuario, motivo_anulacion = 'reemplazada por una aprobación nueva'
  where carga_id = p_carga and anulada_en is null;
  insert into ventas.aprobacion_carga (carga_id, usuario_id, rol, huella, ultimo_mes_cerrado, alertas, motivo)
  values (p_carga, p_usuario, p_rol, ventas.huella_carga(p_carga), p_ultimo_mes_cerrado, coalesce(p_alertas, '[]'), nullif(trim(p_motivo), ''))
  returning id into nueva;
  return nueva;
end $$;

create or replace function ventas.anular_aprobacion(p_carga uuid, p_usuario uuid, p_motivo text) returns void
language plpgsql set search_path = '' as $$
begin
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'quitar la aprobación necesita un motivo'; end if;
  update ventas.aprobacion_carga set anulada_en = now(), anulada_por = p_usuario, motivo_anulacion = trim(p_motivo)
  where carga_id = p_carga and anulada_en is null;
  if not found then raise exception 'la carga no tiene una aprobación vigente'; end if;
end $$;

/** Última aprobación sin anular de cada carga, con su autor y si sigue al día (huella igual a la de ahora). */
create or replace function ventas.aprobaciones(p_cargas uuid[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'carga_id', a.carga_id, 'usuario', pe.nombre, 'rol', a.rol, 'creado_en', a.creado_en,
    'ultimo_mes_cerrado', a.ultimo_mes_cerrado, 'alertas', a.alertas, 'motivo', a.motivo,
    'al_dia', a.huella = ventas.huella_carga(a.carga_id))), '[]'::jsonb)
  from (select distinct on (x.carga_id) x.* from ventas.aprobacion_carga x
        where x.carga_id = any(p_cargas) and x.anulada_en is null order by x.carga_id, x.id desc) a
  left join public.perfil pe on pe.user_id = a.usuario_id;
$$;

drop function if exists ventas.publicar(uuid, text, uuid, boolean);
create or replace function ventas.publicar(p_carga uuid, p_notas text default null, p_usuario uuid default null, p_rol text default 'servicio')
returns jsonb language plpgsql set statement_timeout = '10min' as $$
declare
  c ventas.carga;
  a ventas.aprobacion_carga;
  v int;
  vig int;
  reemplazos jsonb;
  corte date;
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

  -- conciliada_bi queda en false: solo un control de BI que coincida la marca (G11, 0021).
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
  return jsonb_build_object('version', v, 'carga', p_carga, 'archivo', c.nombre_archivo, 'fecha_corte', corte, 'meses_reemplazados', reemplazos);
end $$;

create or replace function ventas.versiones() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'version', p.version, 'fecha_corte', p.fecha_corte, 'publicado_en', p.publicado_en, 'archivo', c.nombre_archivo,
      'notas', p.notas, 'publicado_por', pp.nombre, 'rol_publicacion', p.rol_publicacion, 'ultimo_mes_cerrado', p.ultimo_mes_cerrado,
      'aprobado_por', case when a.id is not null then pa.nombre end, 'rol_aprobacion', a.rol, 'aprobado_en', a.creado_en,
      'motivo_aprobacion', a.motivo, 'alertas_aceptadas', coalesce(jsonb_array_length(a.alertas), 0),
      'meses', (select jsonb_agg(jsonb_build_object('anio', cm.anio, 'mes', cm.mes) order by cm.anio, cm.mes) from ventas.carga_mes cm where cm.carga_id = p.carga_id),
      'meses_reemplazados', p.meses_reemplazados,
      'conciliada_bi', p.conciliada_bi, 'conciliada_nota', p.conciliada_nota, 'conciliada_en', p.conciliada_en,
      'retirada_en', p.retirada_en, 'motivo_retiro', p.motivo_retiro
    ) order by p.version desc)
    from ventas.publicacion p
    join ventas.carga c on c.id = p.carga_id
    left join ventas.aprobacion_carga a on a.id = p.aprobacion_id
    left join public.perfil pa on pa.user_id = a.usuario_id
    left join public.perfil pp on pp.user_id = p.publicado_por
  ), '[]'::jsonb);
end $$;

revoke execute on function ventas.huella_carga(uuid), ventas.aprobar_carga(uuid, uuid, text, boolean, jsonb, text, text),
  ventas.anular_aprobacion(uuid, uuid, text), ventas.aprobaciones(uuid[]), ventas.publicar(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function ventas.huella_carga(uuid), ventas.aprobar_carga(uuid, uuid, text, boolean, jsonb, text, text),
  ventas.anular_aprobacion(uuid, uuid, text), ventas.aprobaciones(uuid[]), ventas.publicar(uuid, text, uuid, text)
  to service_role;
