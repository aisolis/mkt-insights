-- La bitácora del asistente la escribe solo el servidor (G8). Con insert para authenticated, un usuario podía
-- agregar por la API filas con texto o respuesta inventados en su propia conversación, y el servidor los usaba
-- como historial y memoria del modelo. Ahora el insert lo hace el servidor con service_role, después de comprobar
-- con la sesión del usuario (RLS) que la conversación es suya. Cada quien sigue leyendo solo sus filas.

drop policy if exists "bitácora: registra el propio usuario con acceso" on ventas.consulta_asistente;
revoke insert on ventas.consulta_asistente from authenticated;
revoke usage, select on sequence ventas.consulta_asistente_id_seq from authenticated;

notify pgrst, 'reload schema';
