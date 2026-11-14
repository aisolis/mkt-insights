-- /clientes se caía por tiempo (8 s para authenticated) desde 0026. Con la política de ámbito sobre ventas.hecho el
-- planificador ya no estima cuántas filas pasan el filtro (lo calcula con parámetros de la sesión) y, para agrupar el
-- millón de líneas, elegía ordenar en disco en vez de agrupar en memoria: 7.7 s en lugar de 3.9 s. Con las dos
-- consultas de la página a la vez se pasaba del límite.
--
-- La función ya planea con EXECUTE y valores reales; aquí además se le pide agrupar en memoria (sin ordenar el millón
-- de líneas) y sin nested loop. Medido como lector_ventas: 3.9 s, igual que sin política.
alter function interno._clientes_estado(int, int, int, int, int, jsonb) set enable_sort = off;
alter function interno._clientes_estado(int, int, int, int, int, jsonb) set enable_nestloop = off;

-- Las funciones del ámbito leen la sesión directo (sin auth.jwt/auth.uid, que no son parallel safe) y se marcan
-- parallel safe: la política no impide que la base reparta el recorrido de ventas.hecho entre varios procesos.
create or replace function interno.alcance_sesion() returns jsonb
language sql stable parallel safe set search_path = '' as $$
  select case
    when coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then null
    else (select p.alcance from public.perfil p
          where p.user_id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid and p.activo)
  end
$$;

create or replace function interno.alcance_lista(p_dim text) returns text[]
language sql stable parallel safe set search_path = '' as $$
  select case when a ? p_dim then array(select jsonb_array_elements_text(a -> p_dim)) end
  from (select interno.alcance_sesion() a) x
$$;
