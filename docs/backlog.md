# Backlog inicial por goal

## G2 — Carga y verificación
- [ ] Repo Next.js 15 + TS + shadcn/ui + Supabase (crear fuera de OneDrive: `npx create-next-app@latest bia-foresight --ts --app --tailwind --eslint`)
- [ ] Migración `0001_init.sql`; seed `docs/homologacion-canal.csv`
- [ ] Script de ingesta (Node/TS, calamine o exceljs streaming): XLSX → Storage privado → job → `ventas.hecho`; serial Excel → fecha; códigos a texto; flags duplicado/discrepancia
- [ ] Test de paridad: totales por mes/canal/empresa == `analisis/totales_*.csv` (1,073,421 filas; neta 3,367,463,789.74; kg 17,795,035.1532)
- [ ] Pantalla "Cargas y versiones": subir, ver estado, errores, publicar versión

## G3 — Dashboard
- [x] Layout del prototipo: sidebar (Inicio, Asistente, Cargas y versiones, Conocimiento, Perfiles y accesos), cabecera versión/corte/conciliada
- [x] Filtros: periodo, comparar con (mes ant./año ant.), canal, ruta, marca, producto
- [x] KPIs: venta neta, kg (t), precio/kg, clientes con compra + variación vs. mes y año anterior
- [x] Gráfica mensual, barras variación por canal, tabla rutas que más contribuyen, exportar CSV
- [x] Botón "Preguntar al asistente" con filtros actuales (el asistente los lee en G4)
- [ ] Mientras no haya Auth (G5) el servidor lee con service_role: no desplegar antes de G5

## G4 — Asistente
- [x] Catálogo de herramientas tipadas (sin SQL libre): kpi_periodo, variacion_por_dimension, top_rutas, serie_mensual, descomposicion
- [x] OpenRouter server-side; prompt con contrato de respuesta (texto + tabla/gráfica + evidencia + hechos/hipótesis)
- [x] Verificador de cifras del modelo (tolera redondeos) y modo determinista (sin llave o si el modelo falla)
- [x] Bitácora `ventas.consulta_asistente` (pregunta, respuesta, consultas, versión, modo, modelo, duración); `usuario_id` se llena en G5
- [x] Banco de 15 preguntas de prueba (incluye fuera de alcance: share, visitas, pedidos) — `docs/banco-preguntas.md`
- [ ] Probar el modo modelo con `OPENROUTER_API_KEY` real (hoy vacía en `.env.local`) y correr el banco también en ese modo

## G5 — Acceso
- [ ] Supabase Auth: invitación por correo (Resend), MFA TOTP
- [ ] RLS por nivel: Estándar sin cliente_nombre/cliente_codigo; Plus completo
- [ ] Perfiles y accesos (admin)

## G6 — Conocimiento
- [ ] Subida de PDFs autorizados a Storage, extracción de texto, embeddings (pgvector), audiencia por nivel
- [ ] Citas en respuestas híbridas, separadas de los hechos

## G7 — Operación
- [ ] Runbook mensual para Nati; snapshot por mes (S8); retiro de versión
