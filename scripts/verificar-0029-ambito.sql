-- Paridad de 0029 con ámbito por persona, sobre los datos de scripts/datos-sinteticos-local.sql (usa sus rutas y canales).
-- Crea 5 usuarios de prueba con ámbitos distintos y compara cada lectura nueva contra interno.*_v1 como lector_ventas.
-- SOLO BASE LOCAL (Docker): se niega a correr si no se pasa -v local=si. Escribe en tablas reales.
\if :{?local}
\else
  \echo 'Falta -v local=si: este script es solo para la base local de pruebas.'
  \quit
\endif
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
set statement_timeout = 0;
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000001', 'canal@prueba.test'),
  ('00000000-0000-4000-a000-000000000002', 'empresa@prueba.test'),
  ('00000000-0000-4000-a000-000000000003', 'ruta@prueba.test'),
  ('00000000-0000-4000-a000-000000000004', 'empresa-canal@prueba.test'),
  ('00000000-0000-4000-a000-000000000005', 'sin-ambito@prueba.test')
on conflict (id) do nothing;
insert into public.perfil (user_id, nombre, nivel, es_admin, activo, alcance) values
  ('00000000-0000-4000-a000-000000000001', 'canal', 'plus', false, true, '{"canal":["Detalle","Moderno"]}'),
  ('00000000-0000-4000-a000-000000000002', 'empresa', 'plus', false, true, '{"empresa":["BIA"]}'),
  ('00000000-0000-4000-a000-000000000003', 'ruta', 'plus', false, true, '{"ruta":["R007 Centro","R012 Centro","R030 Norte"]}'),
  ('00000000-0000-4000-a000-000000000004', 'empresa-canal', 'plus', false, true, '{"empresa":["INDECA"],"canal":["Mayoreo"]}'),
  ('00000000-0000-4000-a000-000000000005', 'sin-ambito', 'plus', false, true, null)
on conflict (user_id) do update set alcance = excluded.alcance, activo = true;

create temp table res (usuario text, funcion text, args text, igual boolean, nuevo text);
grant all on res to lector_ventas;

create or replace function pg_temp.probar(p_usuario text, p_sub text) returns void language plpgsql as $$
declare
  p record; f record; n jsonb; v jsonb; d bigint; tot bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  for p in select * from (values (2026,10,2025,10),(2026,10,2026,9),(2022,3,2021,12)) x(a,m,ac,mc) loop
    for f in select * from (values ('{}'::jsonb),('{"canal":"Detalle"}'),('{"canal":"Mayoreo"}'),('{"ruta":"R007 Centro"}'),('{"ruta":"R001 Sur"}'),
                                   ('{"marca":"Marca 3"}'),('{"empresa":"BIA"}'),('{"empresa":"INDECA"}'),('{"empresa":"BIA","canal":"Moderno","marca":"Marca 1"}')) x(j) loop
      n := interno.kpi_periodo(1,p.a,p.m,p.ac,p.mc,f.j); v := interno.kpi_periodo_v1(1,p.a,p.m,p.ac,p.mc,f.j);
      insert into res values (p_usuario, 'kpi', p::text || f.j::text, n::text = v::text, n::text);
      n := interno.acumulado_anio(1,p.a,p.m,f.j); v := interno.acumulado_anio_v1(1,p.a,p.m,f.j);
      insert into res values (p_usuario, 'acumulado', p::text || f.j::text, n::text = v::text, n::text);
      n := interno.puente_precio_volumen_mezcla(1,p.a,p.m,p.ac,p.mc,f.j,5); v := interno.puente_precio_volumen_mezcla_v1(1,p.a,p.m,p.ac,p.mc,f.j,5);
      insert into res values (p_usuario, 'puente', p::text || f.j::text, n::text = v::text, n::text);
      n := interno.variacion_por_dimension(1,'canal',p.a,p.m,p.ac,p.mc,f.j); v := interno.variacion_por_dimension_v1(1,'canal',p.a,p.m,p.ac,p.mc,f.j);
      insert into res values (p_usuario, 'variacion canal', p::text || f.j::text,
        (select coalesce(jsonb_agg(e order by e::text), '[]') from jsonb_array_elements(n) e)::text = (select coalesce(jsonb_agg(e order by e::text), '[]') from jsonb_array_elements(v) e)::text, n::text);
      n := interno.top_contribuyentes(1,p.a,p.m,p.ac,p.mc,f.j,5000); v := interno.top_contribuyentes_v1(1,p.a,p.m,p.ac,p.mc,f.j,5000);
      insert into res values (p_usuario, 'top', p::text || f.j::text,
        (select coalesce(jsonb_agg(e order by e::text), '[]') from jsonb_array_elements(n) e)::text = (select coalesce(jsonb_agg(e order by e::text), '[]') from jsonb_array_elements(v) e)::text, null);
      select count(*) into d from ((select * from interno._clientes_estado(1,p.a,p.m,p.ac,p.mc,f.j) except all select * from interno._clientes_estado_v1(1,p.a,p.m,p.ac,p.mc,f.j))
        union all (select * from interno._clientes_estado_v1(1,p.a,p.m,p.ac,p.mc,f.j) except all select * from interno._clientes_estado(1,p.a,p.m,p.ac,p.mc,f.j))) z;
      select count(*) into tot from interno._clientes_estado(1,p.a,p.m,p.ac,p.mc,f.j);
      insert into res values (p_usuario, 'clientes', p::text || f.j::text, d = 0, tot::text);
    end loop;
  end loop;
end $$;

begin;
set local role lector_ventas;
select pg_temp.probar('canal', '00000000-0000-4000-a000-000000000001');
select pg_temp.probar('empresa', '00000000-0000-4000-a000-000000000002');
select pg_temp.probar('ruta', '00000000-0000-4000-a000-000000000003');
select pg_temp.probar('empresa-canal', '00000000-0000-4000-a000-000000000004');
select pg_temp.probar('sin-ambito', '00000000-0000-4000-a000-000000000005');
commit;

\echo == comparaciones por usuario (distintas / total)
select usuario || ': ' || count(*) filter (where not igual) || ' distintas de ' || count(*) from res group by usuario order by usuario;
\echo == detalle de distintas (si hay)
select usuario, funcion, args from res where not igual limit 20;
\echo == el ambito SI recorta (venta de oct 2026 sin filtros, por usuario)
select usuario || ': venta ' || (nuevo::jsonb->>'venta_neta') || ' · clientes ' || (nuevo::jsonb->>'clientes_con_compra')
from res where funcion = 'kpi' and args like '(2026,10,2025,10)%' and args like '%{}' order by usuario;
\echo == clientes listados sin filtros oct 2026, por usuario
select usuario || ': ' || nuevo from res where funcion = 'clientes' and args like '(2026,10,2025,10)%' and args like '%{}' order by usuario;
