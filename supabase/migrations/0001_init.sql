-- BIA Foresight — esquema inicial (G2). Importes en numeric, nunca float.
create schema if not exists ventas;
grant usage on schema ventas to anon, authenticated, service_role;

create table ventas.carga (
  id uuid primary key default gen_random_uuid(),
  nombre_archivo text not null,
  sha256 text not null unique,
  bytes bigint not null,
  periodo_desde date, periodo_hasta date,
  estado text not null default 'recibida' check (estado in ('recibida','procesando','validada','con_errores','publicada','retirada')),
  filas_leidas int, filas_vacias int, filas_cargadas int,
  subido_por uuid references auth.users(id),
  creado_en timestamptz not null default now()
);

create table ventas.publicacion (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  carga_id uuid not null references ventas.carga(id),
  fecha_corte date not null,
  conciliada_bi boolean not null default false,
  notas text,
  aprobado_por uuid references auth.users(id),
  publicado_en timestamptz not null default now()
);

-- Homologaciones editables (S2)
create table ventas.homologacion (
  dimension text not null check (dimension in ('canal','grupo','subgrupo','sucursal')),
  valor_origen text not null,
  valor_homologado text not null,
  revisar boolean not null default false,
  primary key (dimension, valor_origen)
);

-- Hecho: línea de factura, 24 campos origen preservados + derivados
create table ventas.hecho (
  id bigint generated always as identity primary key,
  carga_id uuid not null references ventas.carga(id) on delete cascade,
  hoja text not null, fila_origen int not null,
  fecha date not null,
  anio smallint not null, mes smallint not null,
  ruta text not null, empresa text not null, marca text not null,
  categoria text not null,           -- Café/Rep
  proveedor text not null,
  cliente_codigo text not null, cliente_nombre text not null,
  zona text not null,
  documento text not null,           -- nº factura
  grupo text not null, canal_origen text not null, canal text not null,  -- canal homologado
  art_codigo text not null, art_descrip text not null,
  cantidad numeric(14,4) not null,
  venta_bruta numeric(16,2) not null, descuentos numeric(16,2) not null, venta_neta numeric(16,2) not null,
  kg numeric(14,4) not null, fardos_caja numeric(14,5),
  subgrupo text not null,            -- NO exponer a IA (S10)
  sucursal text not null,
  flag_duplicado boolean not null default false,
  flag_discrepancia boolean not null default false,
  flag_fecha_serial boolean not null default false
);
create index on ventas.hecho (carga_id);
create index on ventas.hecho (anio, mes, canal);
create index on ventas.hecho (anio, mes, ruta);
create index on ventas.hecho (empresa, cliente_codigo);
create index on ventas.hecho (marca, art_codigo);

create table public.perfil (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  nivel text not null check (nivel in ('estandar','plus')),
  es_admin boolean not null default false,
  es_aprobador boolean not null default false
);

alter table ventas.hecho enable row level security;
alter table ventas.carga enable row level security;
alter table ventas.publicacion enable row level security;
alter table ventas.homologacion enable row level security;
alter table public.perfil enable row level security;
-- Políticas RLS: 0003_rls.sql (G5). Hasta entonces solo service_role accede.
-- Un esquema propio no hereda los privilegios por defecto que Supabase da en public.
grant all on all tables in schema ventas to service_role;
grant all on all sequences in schema ventas to service_role;
alter default privileges in schema ventas grant all on tables to service_role;
alter default privileges in schema ventas grant all on sequences to service_role;
