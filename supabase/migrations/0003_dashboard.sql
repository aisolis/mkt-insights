-- G3: funciones del dashboard. Mismo contrato que 0002: el cálculo vive aquí y la UI solo muestra.
-- (Las políticas RLS de G5 irán en una migración posterior.)

-- Metadatos fijos de la versión (ver ventas._metadatos_carga más abajo).
alter table ventas.publicacion add column if not exists metadatos jsonb;

-- Reemplaza la versión de 0002:
-- * filtra el periodo dentro de la CTE (antes se materializaba la versión entera: 1–5 s);
-- * S4: cliente con compra = cliente cuya venta neta SUMADA en el periodo es > 0, no "alguna línea > 0";
-- * agrega cobertura de rutas (rutas con movimiento en el periodo / rutas de la versión).
create or replace function ventas.kpi_periodo(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}'
) returns jsonb language sql stable security invoker as $$
  with base as (
    select h.anio, h.mes, h.empresa, h.cliente_codigo, h.ruta, h.venta_neta, h.kg,
           (h.anio = p_anio and h.mes = p_mes) es_actual
    from ventas.hecho h
    join ventas.publicacion p on p.carga_id = h.carga_id and p.version = p_version
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
$$;

-- Tabla "Rutas que más contribuyen a la variación": ruta × canal, ordenada por |variación|.
create or replace function ventas.top_contribuyentes(
  p_version int, p_anio int, p_mes int, p_anio_cmp int, p_mes_cmp int, p_filtros jsonb default '{}', p_limite int default 10
) returns jsonb language sql stable security invoker as $$
  with g as (
    select h.ruta, h.canal,
      coalesce(sum(h.venta_neta) filter (where h.anio = p_anio and h.mes = p_mes), 0) actual,
      coalesce(sum(h.venta_neta) filter (where h.anio = p_anio_cmp and h.mes = p_mes_cmp), 0) anterior
    from ventas.hecho h
    join ventas.publicacion p on p.carga_id = h.carga_id and p.version = p_version
    where ((h.anio = p_anio and h.mes = p_mes) or (h.anio = p_anio_cmp and h.mes = p_mes_cmp))
      and ventas._where_filtros(h, p_filtros)
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('ruta', ruta, 'canal', canal, 'actual', actual, 'anterior', anterior, 'variacion', actual - anterior)
                            order by abs(actual - anterior) desc, ruta), '[]'::jsonb)
  from (select * from g order by abs(actual - anterior) desc, ruta limit greatest(p_limite, 0)) t;
$$;

-- Metadatos fijos de una versión, calculados UNA vez al publicar (recorrer 1 M de filas por request costaba ~12 s):
-- periodos (S7: el mes de la fecha máxima no está cerrado), opciones de filtros y total de rutas para la cobertura.
-- Nunca incluye cliente ni subgrupo (S10, S12).

create or replace function ventas._metadatos_carga(p_carga uuid)
returns jsonb language sql stable as $$
  with b as (
    select fecha, anio, mes, canal, ruta, marca, art_codigo, art_descrip from ventas.hecho where carga_id = p_carga
  ),
  m as (select anio, mes, count(distinct fecha) dias, max(fecha) ultimo from b group by 1, 2)
  select jsonb_build_object(
    'periodos', (select jsonb_agg(jsonb_build_object('anio', anio, 'mes', mes, 'dias', dias, 'ultimo_dia', ultimo,
                                                     'cerrado', make_date(anio, mes, 1) < date_trunc('month', (select max(ultimo) from m)))
                                  order by anio, mes) from m),
    'canal', (select jsonb_agg(v order by v) from (select distinct canal v from b) s),
    'ruta',  (select jsonb_agg(v order by v) from (select distinct ruta v from b) s),
    'marca', (select jsonb_agg(v order by v) from (select distinct marca v from b) s),
    'producto', (select jsonb_agg(jsonb_build_object('codigo', codigo, 'descripcion', descripcion) order by descripcion, codigo)
                 from (select art_codigo codigo, min(art_descrip) descripcion from b group by art_codigo) s),
    'rutas_total', (select count(distinct ruta) from b)
  );
$$;

-- Resumen mensual sin cliente (92 k filas contra 1.07 M): la serie del año sale de aquí en vez de hecho.
create table if not exists ventas.resumen_mensual (
  carga_id uuid not null references ventas.carga(id) on delete cascade,
  anio smallint not null, mes smallint not null,
  empresa text not null, canal text not null, ruta text not null, marca text not null, art_codigo text not null,
  filas int not null, venta_neta numeric(16,2) not null, kg numeric(14,4) not null,
  primary key (carga_id, anio, mes, empresa, canal, ruta, marca, art_codigo)
);
alter table ventas.resumen_mensual enable row level security;
grant all on ventas.resumen_mensual to service_role;

create or replace function ventas._llenar_resumen(p_carga uuid) returns void language sql as $$
  delete from ventas.resumen_mensual where carga_id = p_carga;
  insert into ventas.resumen_mensual
  select carga_id, anio, mes, empresa, canal, ruta, marca, art_codigo, count(*), sum(venta_neta), sum(kg)
  from ventas.hecho where carga_id = p_carga
  group by carga_id, anio, mes, empresa, canal, ruta, marca, art_codigo;
$$;

create or replace function ventas._publicacion_metadatos() returns trigger language plpgsql as $$
begin
  new.metadatos := ventas._metadatos_carga(new.carga_id);
  perform ventas._llenar_resumen(new.carga_id);
  return new;
end $$;

drop trigger if exists publicacion_metadatos on ventas.publicacion;
create trigger publicacion_metadatos before insert or update of carga_id on ventas.publicacion
  for each row execute function ventas._publicacion_metadatos();

-- Versiones publicadas antes de esta migración.
update ventas.publicacion set metadatos = ventas._metadatos_carga(carga_id) where metadatos is null;
select ventas._llenar_resumen(p.carga_id) from ventas.publicacion p
where not exists (select 1 from ventas.resumen_mensual r where r.carga_id = p.carga_id);

-- Versión vigente: cabecera (siempre visible), periodos y opciones de filtros.
create or replace function ventas.version_vigente()
returns jsonb language sql stable security invoker as $$
  select jsonb_build_object('version', p.version, 'fecha_corte', p.fecha_corte, 'conciliada_bi', p.conciliada_bi,
                            'publicado_en', p.publicado_en, 'archivo', c.nombre_archivo, 'metadatos', p.metadatos)
  from ventas.publicacion p join ventas.carga c on c.id = p.carga_id
  order by p.version desc limit 1;
$$;

-- Reemplaza la versión de 0002: lee del resumen mensual (1.2 s → decenas de ms). Mismos filtros que _where_filtros.
create or replace function ventas.serie_mensual(p_version int, p_anio int, p_filtros jsonb default '{}')
returns jsonb language sql stable security invoker as $$
  select coalesce(jsonb_agg(jsonb_build_object('anio', anio, 'mes', mes, 'venta_neta', vn, 'kg', kg) order by mes), '[]'::jsonb)
  from (
    select r.anio, r.mes, sum(r.venta_neta) vn, sum(r.kg) kg
    from ventas.resumen_mensual r join ventas.publicacion p on p.carga_id = r.carga_id and p.version = p_version
    where r.anio = p_anio
      and (p_filtros->>'empresa'    is null or r.empresa    = p_filtros->>'empresa')
      and (p_filtros->>'canal'      is null or r.canal      = p_filtros->>'canal')
      and (p_filtros->>'ruta'       is null or r.ruta       = p_filtros->>'ruta')
      and (p_filtros->>'marca'      is null or r.marca      = p_filtros->>'marca')
      and (p_filtros->>'art_codigo' is null or r.art_codigo = p_filtros->>'art_codigo')
    group by 1, 2
  ) s;
$$;

-- Publicar una carga validada como la siguiente versión, en una sola transacción.
-- El trigger de publicación recorre la carga completa (~12 s con 1 M de filas); PostgREST corta a los 8 s
-- (statement_timeout de authenticator), así que la función trae su propio límite.
create or replace function ventas.publicar(p_carga uuid, p_notas text default null)
returns jsonb language plpgsql set statement_timeout = '10min' as $$
declare
  c ventas.carga;
  v int;
begin
  select * into c from ventas.carga where id = p_carga for update;
  if not found then raise exception 'la carga % no existe', p_carga; end if;
  if c.estado <> 'validada' then raise exception 'la carga % está en estado "%", no "validada"', p_carga, c.estado; end if;
  lock table ventas.publicacion in exclusive mode; -- dos publicaciones simultáneas no pueden tomar el mismo número
  select coalesce(max(version), 0) + 1 into v from ventas.publicacion;
  -- conciliada_bi queda en false: solo el reporte de BI permite marcarla (CONTEXTO §5).
  insert into ventas.publicacion (version, carga_id, fecha_corte, conciliada_bi, notas) values (v, p_carga, c.periodo_hasta, false, p_notas);
  update ventas.carga set estado = 'publicada' where id = p_carga;
  return jsonb_build_object('version', v, 'carga', p_carga, 'archivo', c.nombre_archivo, 'fecha_corte', c.periodo_hasta, 'filas', c.filas_cargadas);
end $$;
revoke execute on function ventas.publicar(uuid, text) from public, anon, authenticated;
grant execute on function ventas.publicar(uuid, text) to service_role;
