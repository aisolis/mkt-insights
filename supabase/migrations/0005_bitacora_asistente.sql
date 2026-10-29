-- Bitácora del asistente: cada pregunta con su respuesta, consultas y evidencia, para auditoría y para revisar
-- el banco de preguntas. Solo agregados (las respuestas nunca llevan datos de clientes, S10/S15).
-- usuario_id queda nulo hasta G5 (Auth).

create table ventas.consulta_asistente (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  usuario_id uuid references auth.users(id) on delete set null,
  version int references ventas.publicacion(version),
  contexto text not null default '',          -- query string heredada del dashboard
  pregunta text not null,
  estado text not null check (estado in ('ok', 'fuera_de_alcance', 'sin_datos', 'error')),
  modo text check (modo in ('modelo', 'determinista')),
  modelo text,                                -- id de OpenRouter cuando hubo modelo configurado
  texto text,
  respuesta jsonb,                            -- Respuesta completa (hechos, hipótesis, evidencia, consultas)
  error text,
  duracion_ms int
);
create index on ventas.consulta_asistente (creado_en desc);

alter table ventas.consulta_asistente enable row level security;
grant all on ventas.consulta_asistente to service_role;
grant usage, select on sequence ventas.consulta_asistente_id_seq to service_role;
