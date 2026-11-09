-- G11 (V1-03/21, S30): la carga se procesa en segundo plano. Quien procesa "toma" la carga con un número de intento
-- (lease con fencing): solo ese intento puede avanzar, cerrar o fallar la carga. Si el proceso deja de dar señales
-- (latido) por 2 minutos, otro puede retomarla desde cero; el intento viejo, si revive, ya no escribe nada.

alter table ventas.carga
  add column etapa text,                -- qué está haciendo ahora: descargando, leyendo filas, calculando totales
  add column avance_filas int,          -- filas cargadas hasta ahora
  add column latido_en timestamptz,     -- última señal del proceso
  add column procesando_desde timestamptz,
  add column intento int not null default 0;

/** Toma la carga para procesarla. Devuelve el número de intento, o null si otro proceso la tiene viva o ya terminó. */
create or replace function ventas.tomar_carga(p_carga uuid, p_vencido interval default '2 minutes') returns int
language sql set search_path = '' as $$
  update ventas.carga set estado = 'procesando', error = null, etapa = 'en cola', avance_filas = 0, latido_en = now(),
    procesando_desde = now(), intento = intento + 1
  where id = p_carga
    and (estado in ('recibida', 'con_errores') or (estado = 'procesando' and coalesce(latido_en, '-infinity') < now() - p_vencido))
  returning intento;
$$;

/** Señal de vida con la etapa y el avance. false = este intento ya no es el dueño de la carga: hay que parar. */
create or replace function ventas.latir_carga(p_carga uuid, p_intento int, p_etapa text, p_avance int default null) returns boolean
language sql set search_path = '' as $$
  with u as (
    update ventas.carga set latido_en = now(), etapa = p_etapa, avance_filas = coalesce(p_avance, avance_filas)
    where id = p_carga and intento = p_intento and estado = 'procesando'
    returning 1
  )
  select exists (select 1 from u);
$$;

revoke execute on function ventas.tomar_carga(uuid, interval), ventas.latir_carga(uuid, int, text, int) from public, anon, authenticated;
grant execute on function ventas.tomar_carga(uuid, interval), ventas.latir_carga(uuid, int, text, int) to service_role;

-- Fencing dentro de la base: borrar, insertar y cerrar comprueban el intento bajo un bloqueo de la fila de la carga.
-- tomar_carga necesita ese mismo bloqueo, así que un intento nuevo no puede colarse entre la comprobación y la escritura.
create or replace function interno.es_dueno_carga(p_carga uuid, p_intento int) returns boolean
language sql set search_path = '' as $$
  select exists (select 1 from ventas.carga where id = p_carga and intento = p_intento and estado = 'procesando' for share);
$$;

/** Al empezar un intento: sin restos de intentos anteriores. */
create or replace function ventas.limpiar_carga(p_carga uuid, p_intento int) returns boolean
language plpgsql set search_path = '' as $$
begin
  if not interno.es_dueno_carga(p_carga, p_intento) then return false; end if;
  delete from ventas.hecho where carga_id = p_carga;
  delete from ventas.fila_cuarentena where carga_id = p_carga;
  return true;
end $$;

/** Un lote de filas de hecho (JSON con las columnas de ventas.hecho, sin id). false = el intento ya no es el dueño. */
create or replace function ventas.insertar_lote(p_carga uuid, p_intento int, p_filas jsonb) returns boolean
language plpgsql set search_path = '' as $$
begin
  if not interno.es_dueno_carga(p_carga, p_intento) then return false; end if;
  insert into ventas.hecho (carga_id, hoja, fila_origen, fecha, anio, mes, ruta, empresa, marca, categoria, proveedor, cliente_codigo,
    cliente_nombre, zona, documento, grupo, canal_origen, canal, art_codigo, art_descrip, cantidad, venta_bruta, descuentos, venta_neta,
    kg, fardos_caja, subgrupo, sucursal, flag_duplicado, flag_discrepancia, flag_fecha_serial)
  select p_carga, r.hoja, r.fila_origen, r.fecha, r.anio, r.mes, r.ruta, r.empresa, r.marca, r.categoria, r.proveedor, r.cliente_codigo,
    r.cliente_nombre, r.zona, r.documento, r.grupo, r.canal_origen, r.canal, r.art_codigo, r.art_descrip, r.cantidad, r.venta_bruta,
    r.descuentos, r.venta_neta, r.kg, r.fardos_caja, r.subgrupo, r.sucursal, r.flag_duplicado, r.flag_discrepancia, r.flag_fecha_serial
  from jsonb_populate_recordset(null::ventas.hecho, p_filas) r;
  return true;
end $$;

/** Cierra la carga (conteos, cuarentena, totales, estado validada) solo si el intento sigue siendo el dueño. */
create or replace function ventas.cerrar_carga_intento(p_carga uuid, p_intento int, p_conteos jsonb, p_cuarentena jsonb) returns boolean
language plpgsql set search_path = '' set statement_timeout = '10min' as $$
begin
  perform 1 from ventas.carga where id = p_carga and intento = p_intento and estado = 'procesando' for update;
  if not found then return false; end if;
  update ventas.carga set
    filas_leidas = (p_conteos->>'filas_leidas')::int, filas_vacias = (p_conteos->>'filas_vacias')::int,
    filas_cargadas = (p_conteos->>'filas_cargadas')::int, filas_duplicadas = (p_conteos->>'filas_duplicadas')::int,
    filas_discrepancia = (p_conteos->>'filas_discrepancia')::int, fechas_serial = (p_conteos->>'fechas_serial')::int,
    hojas_ignoradas = array(select jsonb_array_elements_text(p_conteos->'hojas_ignoradas')), columnas = p_conteos->'columnas',
    filas_cuarentena = jsonb_array_length(p_cuarentena), etapa = null, latido_en = null
  where id = p_carga;
  delete from ventas.fila_cuarentena where carga_id = p_carga;
  insert into ventas.fila_cuarentena (carga_id, hoja, fila, campo, valor, motivo)
  select p_carga, x->>'hoja', (x->>'fila')::int, x->>'campo', x->>'valor', x->>'motivo' from jsonb_array_elements(p_cuarentena) x;
  perform ventas.cerrar_carga(p_carga);
  return true;
end $$;

/** Marca el error y borra lo cargado, solo si el intento sigue siendo el dueño. */
create or replace function ventas.fallar_carga_intento(p_carga uuid, p_intento int, p_error text) returns boolean
language plpgsql set search_path = '' as $$
begin
  perform 1 from ventas.carga where id = p_carga and intento = p_intento and estado = 'procesando' for update;
  if not found then return false; end if;
  delete from ventas.hecho where carga_id = p_carga;
  delete from ventas.fila_cuarentena where carga_id = p_carga;
  update ventas.carga set estado = 'con_errores', error = p_error, etapa = null, latido_en = null where id = p_carga;
  return true;
end $$;

revoke execute on function interno.es_dueno_carga(uuid, int), ventas.limpiar_carga(uuid, int), ventas.insertar_lote(uuid, int, jsonb),
  ventas.cerrar_carga_intento(uuid, int, jsonb, jsonb), ventas.fallar_carga_intento(uuid, int, text) from public, anon, authenticated;
grant execute on function interno.es_dueno_carga(uuid, int), ventas.limpiar_carga(uuid, int), ventas.insertar_lote(uuid, int, jsonb),
  ventas.cerrar_carga_intento(uuid, int, jsonb, jsonb), ventas.fallar_carga_intento(uuid, int, text) to service_role;
