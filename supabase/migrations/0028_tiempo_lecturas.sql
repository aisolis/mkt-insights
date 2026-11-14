-- El dashboard lanza ~10 lecturas a la vez sobre ventas.hecho (KPI del mes y del año anterior, serie, canales, rutas,
-- descomposición, puente, acumulado, rutas atípicas). Cada una tarda 0.1–1.6 s, pero juntas y con la base en frío
-- (recién encendida, sin la tabla en memoria) alguna pasaba los 8 s de authenticated y la página caía
-- («acumulado_anio: canceling statement due to statement timeout»). Igual que clientes en 0027: estas funciones de
-- lectura tienen su propio límite de 30 s (PostgREST v12+ aplica el statement_timeout de la función que se llama).
-- Lo demás sigue con los 8 s del rol.
alter function ventas.kpi_periodo(int, int, int, int, int, jsonb) set statement_timeout = '30s';
alter function ventas.serie_mensual(int, int, jsonb) set statement_timeout = '30s';
alter function ventas.variacion_por_dimension(int, text, int, int, int, int, jsonb) set statement_timeout = '30s';
alter function ventas.top_contribuyentes(int, int, int, int, int, jsonb, int) set statement_timeout = '30s';
alter function ventas.descomposicion(int, int, int, int, int, jsonb) set statement_timeout = '30s';
alter function ventas.puente_precio_volumen_mezcla(int, int, int, int, int, jsonb, int) set statement_timeout = '30s';
alter function ventas.acumulado_anio(int, int, int, jsonb) set statement_timeout = '30s';
alter function ventas.rutas_atipicas(int, int, int, jsonb, int) set statement_timeout = '30s';
notify pgrst, 'reload schema';
