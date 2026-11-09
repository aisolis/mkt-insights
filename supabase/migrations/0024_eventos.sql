-- G11 (V1-17/20, S31): bitácora de accesos y exportaciones. La escribe solo el servidor (service_role) después de
-- comprobar el acceso; la ve el admin en Perfiles y accesos. No guarda nombres ni códigos de cliente ni prompts: en una
-- exportación, qué se exportó (tipo, filtros, versión, filas), no su contenido.

create table ventas.evento (
  id bigint generated always as identity primary key,
  usuario_id uuid references auth.users(id) on delete set null,
  tipo text not null check (tipo in ('ingreso', 'codigo_fallido', 'salida', 'exportacion', 'documento')),
  detalle jsonb not null default '{}',
  creado_en timestamptz not null default now()
);
create index evento_creado on ventas.evento (creado_en desc);
create index evento_usuario on ventas.evento (usuario_id, creado_en desc);
alter table ventas.evento enable row level security;
grant all on ventas.evento to service_role;
