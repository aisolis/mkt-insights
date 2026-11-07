-- G7: un libro puede traer hojas que no son del cubo (resúmenes por canal o por trimestre). La ingesta las salta y
-- las registra aquí para avisarlas antes de publicar, en vez de rechazar el archivo completo.
alter table ventas.carga add column hojas_ignoradas text[] not null default '{}';
notify pgrst, 'reload schema';
