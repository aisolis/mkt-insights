-- G10: columnas del Excel configurables (S26).
-- Hasta G9 la ingesta exigía las 24 columnas del cubo con su nombre exacto y en su orden. Ahora cada campo de
-- ventas.hecho tiene una lista de nombres de columna aceptados ("Café/Rep", "Datos café"…) y la ingesta busca las
-- columnas por nombre, sin importar el orden, las mayúsculas, las tildes ni los signos. También se configuran la fila
-- de los encabezados y las hojas que se saltan. Los campos y su tipo los define el sistema (dashboard, asistente y
-- alertas dependen de ellos); lo configurable es cómo se llaman en el archivo y si pueden faltar.
-- Cada carga guarda cómo se leyeron sus columnas (ventas.carga.columnas) para trazabilidad.
-- Mismo patrón que 0016: RLS activo, sin acceso para anon/authenticated; los cambios van por funciones que solo
-- service_role ejecuta, después de que el servidor verifica que quien lo pide gestiona cargas (admin o aprobador).

-- "Café/Rep" y "cafe rep" son el mismo encabezado: minúsculas, sin tildes y sin signos. Igual que normalizarEncabezado()
-- en src/lib/cargas/columnas.ts.
create or replace function interno._normalizar_encabezado(t text) returns text language sql immutable as $$
  select trim(regexp_replace(lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑÀÈÌÒÙáéíóúüñàèìòù', 'AEIOUUNAEIOUaeiouunaeiou')), '[^a-z0-9]+', ' ', 'g'))
$$;

create table ventas.columna_carga (
  campo text primary key check (campo in (
    'fecha', 'ruta', 'empresa', 'marca', 'categoria', 'proveedor', 'cliente_codigo', 'cliente_nombre', 'zona', 'documento',
    'grupo', 'canal_origen', 'art_codigo', 'art_descrip', 'cantidad', 'venta_bruta', 'descuentos', 'venta_neta', 'kg',
    'fardos_caja', 'subgrupo', 'sucursal')),
  orden smallint not null unique,
  encabezados text[] not null check (cardinality(encabezados) between 1 and 20),
  obligatoria boolean not null default true,
  -- Fijo por campo: solo los descriptivos pueden faltar (se cargan vacíos y la carga lo avisa).
  puede_faltar boolean not null default false,
  check (obligatoria or puede_faltar),
  actualizada_en timestamptz,
  actualizada_por uuid references auth.users(id) on delete set null
);

insert into ventas.columna_carga (campo, orden, encabezados, puede_faltar) values
  ('fecha', 1, '{Fecha}', false),
  ('ruta', 2, '{Ruta}', false),
  ('empresa', 3, '{Empresa}', false),
  ('marca', 4, '{Marca}', false),
  ('categoria', 5, '{Café/Rep}', false),
  ('proveedor', 6, '{Proveedor}', true),
  ('cliente_codigo', 7, '{Cliente Codigo}', false),
  ('cliente_nombre', 8, '{Cliente Nombre}', true),
  ('zona', 9, '{Zona}', true),
  ('documento', 10, '{Documento}', false),
  ('grupo', 11, '{Grupo}', true),
  ('canal_origen', 12, '{Canal BIA}', false),
  ('art_codigo', 13, '{ArtCodigo}', false),
  ('art_descrip', 14, '{ArtDescrip}', true),
  ('cantidad', 15, '{Cantidad}', false),
  ('venta_bruta', 16, '{Venta Bruta}', false),
  ('descuentos', 17, '{Descuentos}', false),
  ('venta_neta', 18, '{Venta Neta}', false),
  ('kg', 19, '{Kg}', false),
  ('fardos_caja', 20, '{Fardos/Caja}', true),
  ('subgrupo', 21, '{Subgrupo}', true),
  ('sucursal', 22, '{Sucursal}', true);

-- Una sola fila: dónde están los encabezados y qué hojas no son de ventas.
create table ventas.formato_carga (
  id boolean primary key default true check (id),
  fila_encabezado smallint not null default 1 check (fila_encabezado between 1 and 50),
  hojas_excluidas text[] not null default '{}' check (cardinality(hojas_excluidas) <= 30),
  actualizada_en timestamptz,
  actualizada_por uuid references auth.users(id) on delete set null
);
insert into ventas.formato_carga (fila_encabezado, hojas_excluidas) values (1, '{Desgloce}');

-- Bitácora: sin llave foránea al campo, las filas quedan aunque cambie el catálogo.
create table ventas.columna_carga_cambio (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('columna', 'formato')),
  campo text,
  antes jsonb,
  despues jsonb,
  usuario_id uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);
create index on ventas.columna_carga_cambio (creado_en desc);

-- Cómo se leyó cada hoja: [{hoja, campos: {campo: encabezado}, faltan_opcionales, sin_usar} | {hoja, ignorada}]
alter table ventas.carga add column if not exists columnas jsonb;

alter table ventas.columna_carga enable row level security;
alter table ventas.formato_carga enable row level security;
alter table ventas.columna_carga_cambio enable row level security;
revoke all on ventas.columna_carga, ventas.formato_carga, ventas.columna_carga_cambio from public, anon, authenticated;
grant all on ventas.columna_carga, ventas.formato_carga, ventas.columna_carga_cambio to service_role;
grant usage, select on sequence ventas.columna_carga_cambio_id_seq to service_role;

/**
 * Cambia los nombres aceptados de un campo y si es obligatorio. Limpia espacios, quita repetidos (con la misma
 * normalización que la ingesta) y no deja que un nombre sirva para dos campos: la ingesta no sabría cuál usar.
 * Bloquea toda la tabla para que dos cambios a la vez no se pisen el control de nombres repetidos.
 */
create or replace function ventas.guardar_columna_carga(p_campo text, p_encabezados text[], p_obligatoria boolean, p_usuario uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  antes ventas.columna_carga;
  limpios text[] := '{}';
  vistos text[] := '{}';
  e text;
  n text;
  choque record;
begin
  lock table ventas.columna_carga in share row exclusive mode;
  select * into antes from ventas.columna_carga where campo = p_campo;
  if not found then raise exception 'Ese campo no existe.'; end if;
  foreach e in array coalesce(p_encabezados, '{}') loop
    e := trim(e);
    n := interno._normalizar_encabezado(e);
    continue when n = '' or n = any(vistos);
    if length(e) > 100 then raise exception 'El nombre «%» pasa de 100 caracteres.', left(e, 30); end if;
    limpios := limpios || e;
    vistos := vistos || n;
  end loop;
  if cardinality(limpios) = 0 then raise exception 'Indica al menos un nombre de columna (con letras o números).'; end if;
  if cardinality(limpios) > 20 then raise exception 'Son más de 20 nombres para un solo campo.'; end if;
  if not coalesce(p_obligatoria, true) and not antes.puede_faltar then
    raise exception 'Este campo no puede faltar: el dashboard y las alertas lo necesitan.';
  end if;
  select c.campo, x.e into choque from ventas.columna_carga c, unnest(c.encabezados) as x(e)
  where c.campo <> p_campo and interno._normalizar_encabezado(x.e) = any(vistos) limit 1;
  if found then raise exception 'El nombre «%» ya se usa para el campo %: un nombre solo puede llenar un campo.', choque.e, choque.campo; end if;

  if antes.encabezados = limpios and antes.obligatoria = coalesce(p_obligatoria, true) then
    return jsonb_build_object('accion', 'sin_cambios');
  end if;
  update ventas.columna_carga set encabezados = limpios, obligatoria = coalesce(p_obligatoria, true),
    actualizada_en = now(), actualizada_por = p_usuario
  where campo = p_campo;
  insert into ventas.columna_carga_cambio (tipo, campo, antes, despues, usuario_id) values ('columna', p_campo,
    jsonb_build_object('encabezados', antes.encabezados, 'obligatoria', antes.obligatoria),
    jsonb_build_object('encabezados', limpios, 'obligatoria', coalesce(p_obligatoria, true)), p_usuario);
  return jsonb_build_object('accion', 'editada', 'encabezados', limpios);
end $$;

/** Fila de los encabezados y hojas que se saltan (resúmenes, tablas dinámicas). */
create or replace function ventas.guardar_formato_carga(p_fila int, p_hojas text[], p_usuario uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  antes ventas.formato_carga;
  hojas text[] := '{}';
  h text;
begin
  if p_fila is null or p_fila < 1 or p_fila > 50 then raise exception 'La fila de los encabezados va de 1 a 50.'; end if;
  foreach h in array coalesce(p_hojas, '{}') loop
    h := trim(h);
    continue when h = '' or h = any(hojas);
    if length(h) > 100 then raise exception 'El nombre de hoja «%» pasa de 100 caracteres.', left(h, 30); end if;
    hojas := hojas || h;
  end loop;
  if cardinality(hojas) > 30 then raise exception 'Son más de 30 hojas para saltar.'; end if;
  select * into antes from ventas.formato_carga for update;
  if antes.fila_encabezado = p_fila and antes.hojas_excluidas = hojas then return jsonb_build_object('accion', 'sin_cambios'); end if;
  update ventas.formato_carga set fila_encabezado = p_fila, hojas_excluidas = hojas, actualizada_en = now(), actualizada_por = p_usuario where id;
  insert into ventas.columna_carga_cambio (tipo, antes, despues, usuario_id) values ('formato',
    jsonb_build_object('fila_encabezado', antes.fila_encabezado, 'hojas_excluidas', antes.hojas_excluidas),
    jsonb_build_object('fila_encabezado', p_fila, 'hojas_excluidas', hojas), p_usuario);
  return jsonb_build_object('accion', 'editada');
end $$;

revoke execute on function
  interno._normalizar_encabezado(text), ventas.guardar_columna_carga(text, text[], boolean, uuid), ventas.guardar_formato_carga(int, text[], uuid)
from public, anon, authenticated;
grant execute on function
  interno._normalizar_encabezado(text), ventas.guardar_columna_carga(text, text[], boolean, uuid), ventas.guardar_formato_carga(int, text[], uuid)
to service_role;
