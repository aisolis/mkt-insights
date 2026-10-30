-- G7: ciclo mensual sin Intelia (S8, S18).
-- Una versión deja de ser "un archivo completo": es una composición por mes. Cada mes de la versión sale de una
-- carga (ventas.version_mes). Publicar una carga copia la composición vigente y reemplaza los meses que trae el
-- archivo (S8: la carga de un mes reemplaza ese mes). Así cada mes se sube solo lo nuevo, sin recargar 1 M de filas.
-- Las funciones de lectura unen por (carga, año, mes) en vez de por carga.

-- Cargas subidas desde la app -------------------------------------------------------------------------------------
alter table ventas.carga alter column sha256 drop not null;   -- se calcula al procesar, no al registrar
alter table ventas.carga
  add column ruta_archivo text,
  add column error text,
  add column procesado_en timestamptz,
  add column filas_duplicadas int,
  add column filas_discrepancia int,
  add column fechas_serial int;

-- Totales por mes de cada carga: alertas antes de publicar y fecha de corte de la composición.
create table ventas.carga_mes (
  carga_id uuid not null references ventas.carga(id) on delete cascade,
  anio smallint not null,
  mes smallint not null,
  filas int not null,
  venta_neta numeric(16,2) not null,
  kg numeric(14,4) not null,
  dias int not null,
  ultimo_dia date not null,
  duplicados int not null,
  discrepancias int not null,
  canales_sin_homologar text[] not null default '{}',
  primary key (carga_id, anio, mes)
);
alter table ventas.carga_mes enable row level security;
grant all on ventas.carga_mes to service_role;

create or replace function ventas._resumir_carga(p_carga uuid) returns void
language sql set statement_timeout = '10min' as $$
  delete from ventas.carga_mes where carga_id = p_carga;
  insert into ventas.carga_mes
  select h.carga_id, h.anio, h.mes, count(*), sum(h.venta_neta), sum(h.kg), count(distinct h.fecha), max(h.fecha),
         count(*) filter (where h.flag_duplicado), count(*) filter (where h.flag_discrepancia),
         coalesce(array_agg(distinct h.canal_origen) filter (where not exists (
           select 1 from ventas.homologacion ho where ho.dimension = 'canal' and ho.valor_origen = h.canal_origen)), '{}')
  from ventas.hecho h where h.carga_id = p_carga
  group by h.carga_id, h.anio, h.mes;
$$;

/** Cierra el procesamiento de una carga: totales por mes, resumen para la serie y estado "validada". */
create or replace function ventas.cerrar_carga(p_carga uuid) returns void
language plpgsql set statement_timeout = '10min' as $$
begin
  perform ventas._resumir_carga(p_carga);
  perform ventas._llenar_resumen(p_carga);
  update ventas.carga c set estado = 'validada', error = null, procesado_en = now(),
    periodo_desde = (select min(make_date(anio, mes, 1)) from ventas.carga_mes where carga_id = p_carga),
    periodo_hasta = (select max(ultimo_dia) from ventas.carga_mes where carga_id = p_carga)
  where c.id = p_carga;
end $$;

-- Composición de cada versión -------------------------------------------------------------------------------------
create table ventas.version_mes (
  version int not null references ventas.publicacion(version) on delete cascade,
  anio smallint not null,
  mes smallint not null,
  carga_id uuid not null references ventas.carga(id),
  primary key (version, anio, mes)
);
create index on ventas.version_mes (carga_id, anio, mes);
alter table ventas.version_mes enable row level security;
grant all on ventas.version_mes to service_role;

alter table ventas.publicacion
  add column ultimo_mes_cerrado boolean not null default false,  -- lo declara quien publica (S7 revisado)
  add column meses_reemplazados jsonb not null default '[]',      -- [{anio, mes, carga_anterior}] para el historial
  add column retirada_en timestamptz,
  add column retirada_por uuid references auth.users(id) on delete set null,
  add column motivo_retiro text,
  add column conciliada_nota text,
  add column conciliada_por uuid references auth.users(id) on delete set null,
  add column conciliada_en timestamptz;

-- Las cargas y versiones existentes: totales por mes y composición (cada versión, todos los meses de su carga).
select ventas._resumir_carga(id) from ventas.carga where estado in ('validada', 'publicada');
insert into ventas.version_mes (version, anio, mes, carga_id)
select p.version, cm.anio, cm.mes, p.carga_id from ventas.publicacion p join ventas.carga_mes cm on cm.carga_id = p.carga_id
on conflict do nothing;

-- Metadatos de la versión (periodos, opciones de filtros, rutas): sobre la composición, al publicar.
-- S7 revisado: un mes está cerrado si no es el último, o si quien publica declaró completo el último.
drop trigger if exists publicacion_metadatos on ventas.publicacion;
create or replace function ventas._metadatos_version(p_version int, p_ultimo_cerrado boolean)
returns jsonb language sql stable set statement_timeout = '10min' as $$
  with b as (
    select h.fecha, h.anio, h.mes, h.canal, h.ruta, h.marca, h.art_codigo, h.art_descrip
    from ventas.hecho h join ventas.version_mes vm on vm.carga_id = h.carga_id and vm.anio = h.anio and vm.mes = h.mes and vm.version = p_version
  ),
  m as (select anio, mes, count(distinct fecha) dias, max(fecha) ultimo from b group by 1, 2),
  tope as (select max(ultimo) u from m)
  select jsonb_build_object(
    'periodos', (select jsonb_agg(jsonb_build_object('anio', anio, 'mes', mes, 'dias', dias, 'ultimo_dia', ultimo,
                                                     'cerrado', make_date(anio, mes, 1) < date_trunc('month', (select u from tope)) or p_ultimo_cerrado)
                                  order by anio, mes) from m),
    'canal', (select jsonb_agg(v order by v) from (select distinct canal v from b) s),
    'ruta',  (select jsonb_agg(v order by v) from (select distinct ruta v from b) s),
    'marca', (select jsonb_agg(v order by v) from (select distinct marca v from b) s),
    'producto', (select jsonb_agg(jsonb_build_object('codigo', codigo, 'descripcion', descripcion) order by descripcion, codigo)
                 from (select art_codigo codigo, min(art_descrip) descripcion from b group by art_codigo) s),
    'rutas_total', (select count(distinct ruta) from b)
  );
$$;

-- Publicar: versión nueva = composición vigente con los meses de la carga reemplazados, en una transacción.
drop function if exists ventas.publicar(uuid, text);
create or replace function ventas.publicar(p_carga uuid, p_notas text default null, p_usuario uuid default null, p_ultimo_mes_cerrado boolean default false)
returns jsonb language plpgsql set statement_timeout = '10min' as $$
declare
  c ventas.carga;
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
  select coalesce(max(version), 0) + 1 into v from ventas.publicacion;
  select version into vig from ventas.publicacion where retirada_en is null order by version desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('anio', cm.anio, 'mes', cm.mes, 'carga_anterior', vm.carga_id) order by cm.anio, cm.mes)
                  filter (where vm.carga_id is not null), '[]'::jsonb)
  into reemplazos
  from ventas.carga_mes cm left join ventas.version_mes vm on vm.version = vig and vm.anio = cm.anio and vm.mes = cm.mes
  where cm.carga_id = p_carga;

  -- conciliada_bi queda en false: solo el reporte de BI permite marcarla (CONTEXTO §5).
  insert into ventas.publicacion (version, carga_id, fecha_corte, conciliada_bi, notas, aprobado_por, ultimo_mes_cerrado, meses_reemplazados)
  values (v, p_carga, c.periodo_hasta, false, p_notas, p_usuario, p_ultimo_mes_cerrado, reemplazos);
  insert into ventas.version_mes (version, anio, mes, carga_id)
  select v, vm.anio, vm.mes, vm.carga_id from ventas.version_mes vm
  where vm.version = vig and not exists (select 1 from ventas.carga_mes cm where cm.carga_id = p_carga and cm.anio = vm.anio and cm.mes = vm.mes);
  insert into ventas.version_mes (version, anio, mes, carga_id) select v, anio, mes, p_carga from ventas.carga_mes where carga_id = p_carga;

  select max(cm.ultimo_dia) into corte from ventas.version_mes vm
  join ventas.carga_mes cm on cm.carga_id = vm.carga_id and cm.anio = vm.anio and cm.mes = vm.mes where vm.version = v;
  update ventas.publicacion set fecha_corte = corte, metadatos = ventas._metadatos_version(v, p_ultimo_mes_cerrado) where version = v;
  update ventas.carga set estado = 'publicada' where id = p_carga;
  return jsonb_build_object('version', v, 'carga', p_carga, 'archivo', c.nombre_archivo, 'fecha_corte', corte, 'meses_reemplazados', reemplazos);
end $$;

-- Retirar: solo la versión vigente (las siguientes se arman sobre ella). Vuelve a regir la anterior.
create or replace function ventas.retirar_version(p_version int, p_motivo text, p_usuario uuid default null)
returns jsonb language plpgsql as $$
declare vig int; anterior int; c uuid;
begin
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'el retiro necesita un motivo'; end if;
  lock table ventas.publicacion in exclusive mode;
  select version, carga_id into vig, c from ventas.publicacion where retirada_en is null order by version desc limit 1;
  if vig is distinct from p_version then raise exception 'solo se retira la versión vigente (v%)', vig; end if;
  select version into anterior from ventas.publicacion where retirada_en is null and version < p_version order by version desc limit 1;
  if anterior is null then raise exception 'no se puede retirar la única versión publicada'; end if;
  update ventas.publicacion set retirada_en = now(), retirada_por = p_usuario, motivo_retiro = trim(p_motivo) where version = p_version;
  update ventas.carga set estado = 'retirada' where id = c;
  return jsonb_build_object('retirada', p_version, 'vigente', anterior);
end $$;

-- Conciliar con BI: solo con una nota que diga contra qué reporte de BI se comparó (CONTEXTO §5).
create or replace function ventas.marcar_conciliada(p_version int, p_nota text, p_usuario uuid default null)
returns void language plpgsql as $$
begin
  if coalesce(length(trim(p_nota)), 0) < 10 then raise exception 'la conciliación necesita una nota con el reporte de BI usado'; end if;
  update ventas.publicacion set conciliada_bi = true, conciliada_nota = trim(p_nota), conciliada_por = p_usuario, conciliada_en = now()
  where version = p_version and retirada_en is null;
  if not found then raise exception 'la versión % no existe o está retirada', p_version; end if;
end $$;

-- Historial de versiones para la pantalla Cargas y versiones (cualquiera con acceso).
create or replace function ventas.versiones() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform interno.exigir_acceso();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'version', p.version, 'fecha_corte', p.fecha_corte, 'publicado_en', p.publicado_en, 'archivo', c.nombre_archivo,
      'notas', p.notas, 'publicado_por', pa.nombre, 'ultimo_mes_cerrado', p.ultimo_mes_cerrado,
      'meses', (select jsonb_agg(jsonb_build_object('anio', cm.anio, 'mes', cm.mes) order by cm.anio, cm.mes) from ventas.carga_mes cm where cm.carga_id = p.carga_id),
      'meses_reemplazados', p.meses_reemplazados,
      'conciliada_bi', p.conciliada_bi, 'conciliada_nota', p.conciliada_nota, 'conciliada_en', p.conciliada_en,
      'retirada_en', p.retirada_en, 'motivo_retiro', p.motivo_retiro
    ) order by p.version desc)
    from ventas.publicacion p
    join ventas.carga c on c.id = p.carga_id
    left join public.perfil pa on pa.user_id = p.aprobado_por
  ), '[]'::jsonb);
end $$;

create or replace function interno.version_vigente() returns jsonb
language sql stable as $$
  select jsonb_build_object('version', p.version, 'fecha_corte', p.fecha_corte, 'conciliada_bi', p.conciliada_bi,
                            'publicado_en', p.publicado_en, 'archivo', c.nombre_archivo, 'metadatos', p.metadatos)
  from ventas.publicacion p join ventas.carga c on c.id = p.carga_id
  where p.retirada_en is null
  order by p.version desc limit 1;
$$;

-- Funciones de lectura: misma lógica, unidas a la composición de la versión.
CREATE OR REPLACE FUNCTION interno.descomposicion(p_version integer, p_anio integer, p_mes integer, p_anio_cmp integer, p_mes_cmp integer, p_filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with base as (
    select (h.anio = p_anio and h.mes = p_mes) es_actual, h.empresa, h.cliente_codigo, h.documento, h.venta_neta, h.kg
    from ventas.hecho h
    join ventas.version_mes vm on vm.carga_id = h.carga_id and vm.anio = h.anio and vm.mes = h.mes and vm.version = p_version
    where ((h.anio = p_anio and h.mes = p_mes) or (h.anio = p_anio_cmp and h.mes = p_mes_cmp))
      and ventas._where_filtros(h, p_filtros)
  ),
  tot as (
    select es_actual, coalesce(sum(venta_neta), 0) vn, coalesce(sum(kg), 0) kg, count(*) lineas from base group by es_actual
  ),
  -- S4 y S14: cuentan los clientes y las facturas cuya venta neta sumada en el periodo es > 0 (sin devoluciones netas).
  cli as (
    select es_actual, count(*) n from (
      select es_actual from base group by es_actual, empresa, cliente_codigo having sum(venta_neta) > 0
    ) x group by es_actual
  ),
  fac as (
    select es_actual, count(*) n from (
      select es_actual from base group by es_actual, empresa, documento having sum(venta_neta) > 0
    ) x group by es_actual
  ),
  lado as (
    select e.es_actual,
      coalesce(t.vn, 0) vn, coalesce(t.kg, 0) kg, coalesce(t.lineas, 0) lineas,
      coalesce(c.n, 0) clientes, coalesce(f.n, 0) facturas
    from (values (true), (false)) e(es_actual)
    left join tot t using (es_actual) left join cli c using (es_actual) left join fac f using (es_actual)
  )
  select jsonb_object_agg(case when es_actual then 'actual' else 'anterior' end, jsonb_build_object(
    'venta_neta', vn, 'kg', kg, 'lineas', lineas, 'clientes', clientes, 'facturas', facturas,
    'facturas_por_cliente', case when clientes > 0 then round(facturas::numeric / clientes, 2) end,
    'ticket_factura', case when facturas > 0 then round(vn / facturas, 2) end,
    'venta_por_cliente', case when clientes > 0 then round(vn / clientes, 2) end))
  from lado;
$function$
;

CREATE OR REPLACE FUNCTION interno.kpi_periodo(p_version integer, p_anio integer, p_mes integer, p_anio_cmp integer, p_mes_cmp integer, p_filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with base as (
    select h.anio, h.mes, h.empresa, h.cliente_codigo, h.ruta, h.venta_neta, h.kg,
           (h.anio = p_anio and h.mes = p_mes) es_actual
    from ventas.hecho h
    join ventas.version_mes vm on vm.carga_id = h.carga_id and vm.anio = h.anio and vm.mes = h.mes and vm.version = p_version
    where ((h.anio = p_anio and h.mes = p_mes) or (h.anio = p_anio_cmp and h.mes = p_mes_cmp))
      and ventas._where_filtros(h, p_filtros)
  ),
  tot as (
    select es_actual, coalesce(sum(venta_neta), 0) vn, coalesce(sum(kg), 0) kg, count(distinct ruta) rutas
    from base group by es_actual
  ),
  cli as (
    select es_actual, count(*) cl from (
      select es_actual from base group by es_actual, empresa, cliente_codigo having sum(venta_neta) > 0
    ) s group by es_actual
  ),
  a as (select coalesce(t.vn, 0) vn, coalesce(t.kg, 0) kg, coalesce(t.rutas, 0) rutas, coalesce(c.cl, 0) cl
        from (select true k) x left join tot t on t.es_actual left join cli c on c.es_actual),
  c as (select coalesce(t.vn, 0) vn, coalesce(t.kg, 0) kg, coalesce(c.cl, 0) cl
        from (select false k) x left join tot t on not t.es_actual left join cli c on not c.es_actual)
  select jsonb_build_object(
    'venta_neta', a.vn, 'kg', a.kg, 'precio_kg', case when a.kg <> 0 then round(a.vn / a.kg, 2) end, 'clientes_con_compra', a.cl,
    'venta_neta_cmp', c.vn, 'kg_cmp', c.kg, 'precio_kg_cmp', case when c.kg <> 0 then round(c.vn / c.kg, 2) end, 'clientes_con_compra_cmp', c.cl,
    'rutas_con_venta', a.rutas, 'rutas_total', (select (metadatos->>'rutas_total')::int from ventas.publicacion where version = p_version))
  from a, c;
$function$
;

CREATE OR REPLACE FUNCTION interno.serie_mensual(p_version integer, p_anio integer, p_filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('anio', anio, 'mes', mes, 'venta_neta', vn, 'kg', kg) order by mes), '[]'::jsonb)
  from (
    select r.anio, r.mes, sum(r.venta_neta) vn, sum(r.kg) kg
    from ventas.resumen_mensual r join ventas.version_mes vm on vm.carga_id = r.carga_id and vm.anio = r.anio and vm.mes = r.mes and vm.version = p_version
    where r.anio = p_anio
      and (p_filtros->>'empresa'    is null or r.empresa    = p_filtros->>'empresa')
      and (p_filtros->>'canal'      is null or r.canal      = p_filtros->>'canal')
      and (p_filtros->>'ruta'       is null or r.ruta       = p_filtros->>'ruta')
      and (p_filtros->>'marca'      is null or r.marca      = p_filtros->>'marca')
      and (p_filtros->>'art_codigo' is null or r.art_codigo = p_filtros->>'art_codigo')
    group by 1, 2
  ) s;
$function$
;

CREATE OR REPLACE FUNCTION interno.top_contribuyentes(p_version integer, p_anio integer, p_mes integer, p_anio_cmp integer, p_mes_cmp integer, p_filtros jsonb DEFAULT '{}'::jsonb, p_limite integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with g as (
    select h.ruta, h.canal,
      coalesce(sum(h.venta_neta) filter (where h.anio = p_anio and h.mes = p_mes), 0) actual,
      coalesce(sum(h.venta_neta) filter (where h.anio = p_anio_cmp and h.mes = p_mes_cmp), 0) anterior
    from ventas.hecho h
    join ventas.version_mes vm on vm.carga_id = h.carga_id and vm.anio = h.anio and vm.mes = h.mes and vm.version = p_version
    where ((h.anio = p_anio and h.mes = p_mes) or (h.anio = p_anio_cmp and h.mes = p_mes_cmp))
      and ventas._where_filtros(h, p_filtros)
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('ruta', ruta, 'canal', canal, 'actual', actual, 'anterior', anterior, 'variacion', actual - anterior)
                            order by abs(actual - anterior) desc, ruta), '[]'::jsonb)
  from (select * from g order by abs(actual - anterior) desc, ruta limit greatest(p_limite, 0)) t;
$function$
;

CREATE OR REPLACE FUNCTION interno.variacion_por_dimension(p_version integer, p_dimension text, p_anio integer, p_mes integer, p_anio_cmp integer, p_mes_cmp integer, p_filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare r jsonb;
begin
  if p_dimension not in ('canal','ruta','zona','sucursal','marca','categoria','art_codigo','empresa') then
    raise exception 'dimension no permitida: %', p_dimension;
  end if;
  execute format($q$
    with base as (
      select h.* from ventas.hecho h
      join ventas.version_mes vm on vm.carga_id = h.carga_id and vm.anio = h.anio and vm.mes = h.mes and vm.version = $1
      where ventas._where_filtros(h, $6)
        and ((h.anio = $2 and h.mes = $3) or (h.anio = $4 and h.mes = $5))
    ), g as (
      select %I valor,
        coalesce(sum(venta_neta) filter (where anio = $2 and mes = $3), 0) actual,
        coalesce(sum(venta_neta) filter (where anio = $4 and mes = $5), 0) anterior
      from base group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object('valor', valor, 'actual', actual, 'anterior', anterior, 'variacion', actual - anterior)
                              order by actual - anterior), '[]'::jsonb) from g
  $q$, p_dimension)
  into r using p_version, p_anio, p_mes, p_anio_cmp, p_mes_cmp, p_filtros;
  return r;
end $function$;

-- Permisos: nada nuevo para authenticated salvo el historial; publicar, retirar y conciliar solo service_role
-- (el servidor verifica antes que quien lo pide sea admin o aprobador con 2FA).
revoke execute on all functions in schema ventas from public, anon, authenticated;
grant execute on function
  ventas.version_vigente(), ventas.kpi_periodo(int, int, int, int, int, jsonb),
  ventas.variacion_por_dimension(int, text, int, int, int, int, jsonb),
  ventas.top_contribuyentes(int, int, int, int, int, jsonb, int), ventas.serie_mensual(int, int, jsonb),
  ventas.descomposicion(int, int, int, int, int, jsonb), ventas.versiones()
to authenticated;
grant execute on all functions in schema ventas to service_role;
revoke execute on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.nivel_acceso() to authenticated;
grant execute on all functions in schema interno to service_role;

-- Storage: Excel del cubo, privado, hasta 50 MB (un mes o un trimestre). La exportación completa va por script.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cargas', 'cargas', false, 50 * 1024 * 1024, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
