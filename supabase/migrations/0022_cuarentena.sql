-- G11 (V1-04/05, S29): filas con una celda que no se entiende (fecha o cifra inválida) ya no tumban la carga entera.
-- Quedan en cuarentena con su hoja, fila, dato y el valor de esa celda (nunca la fila completa: no se copian clientes),
-- fuera de los totales, y la carga avisa con una alerta «Revisar». Si son muchas (más del 1 % y más de 20), la carga
-- sí falla: eso es una exportación mal hecha, no unas celdas sueltas.

create table ventas.fila_cuarentena (
  carga_id uuid not null references ventas.carga(id) on delete cascade,
  hoja text not null,
  fila int not null,
  campo text not null,          -- dato de ventas.hecho (fecha, kg, venta_neta…)
  valor text not null,          -- lo que traía la celda, recortado a 60 caracteres
  motivo text not null,
  primary key (carga_id, hoja, fila)
);
alter table ventas.fila_cuarentena enable row level security;
grant all on ventas.fila_cuarentena to service_role;

alter table ventas.carga add column filas_cuarentena int not null default 0;
