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
