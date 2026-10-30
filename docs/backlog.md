# Backlog inicial por goal

## G2 — Carga y verificación
- [ ] Repo Next.js 15 + TS + shadcn/ui + Supabase (crear fuera de OneDrive: `npx create-next-app@latest bia-foresight --ts --app --tailwind --eslint`)
- [ ] Migración `0001_init.sql`; seed `docs/homologacion-canal.csv`
- [ ] Script de ingesta (Node/TS, calamine o exceljs streaming): XLSX → Storage privado → job → `ventas.hecho`; serial Excel → fecha; códigos a texto; flags duplicado/discrepancia
- [ ] Test de paridad: totales por mes/canal/empresa == `analisis/totales_*.csv` (1,073,421 filas; neta 3,367,463,789.74; kg 17,795,035.1532)
- [x] Pantalla "Cargas y versiones": subir, ver estado, errores, publicar versión (G7)

## G3 — Dashboard
- [x] Layout del prototipo: sidebar (Inicio, Asistente, Cargas y versiones, Conocimiento, Perfiles y accesos), cabecera versión/corte/conciliada
- [x] Filtros: periodo, comparar con (mes ant./año ant.), canal, ruta, marca, producto
- [x] KPIs: venta neta, kg (t), precio/kg, clientes con compra + variación vs. mes y año anterior
- [x] Gráfica mensual, barras variación por canal, tabla rutas que más contribuyen, exportar CSV
- [x] Botón "Preguntar al asistente" con filtros actuales (el asistente los lee en G4)
- [x] Lectura con la sesión del usuario (G5); service_role solo en scripts y administración de usuarios

## G4 — Asistente
- [x] Catálogo de herramientas tipadas (sin SQL libre): kpi_periodo, variacion_por_dimension, top_rutas, serie_mensual, descomposicion
- [x] OpenRouter server-side; prompt con contrato de respuesta (texto + tabla/gráfica + evidencia + hechos/hipótesis)
- [x] Verificador de cifras del modelo (tolera redondeos) y modo determinista (sin llave o si el modelo falla)
- [x] Bitácora `ventas.consulta_asistente` (pregunta, respuesta, consultas, versión, modo, modelo, duración); con `usuario_id` (G5)
- [x] Banco de 15 preguntas de prueba (incluye fuera de alcance: share, visitas, pedidos) — `docs/banco-preguntas.md`
- [ ] Probar el modo modelo con `OPENROUTER_API_KEY` real (hoy vacía en `.env.local`) y correr el banco también en ese modo

## G5 — Acceso
- [x] Supabase Auth: invitación por correo, clave y 2FA TOTP obligatorio; recuperación de clave (pide el código si ya hay 2FA)
- [x] Acceso en la base (`0006_acceso.sql`): funciones de lectura exigen aal2 + perfil activo; tablas de ventas sin acceso directo; bitácora por usuario con RLS
- [x] Estándar sin detalle de clientes (solo agregados); `interno.exigir_acceso('plus')` listo para las funciones con detalle de cliente
- [x] Perfiles y accesos (admin): invitar, reenviar, Estándar/Plus, admin, desactivar/reactivar
- [x] `npm run invitar -- correo "Nombre" plus --admin` para el primer admin
- [ ] Proyecto alojado: SMTP de Supabase con Resend (remitente del dominio de BIA), subir las plantillas de `supabase/templates`, Site URL = dominio de Vercel, activar TOTP, mismo `minimum_password_length` y `password_requirements`, `otp_expiry` 24 h
- [ ] Invitar a Nati (Plus + admin) en el proyecto alojado y probar el flujo con su correo real
- [ ] Vista para admin de la bitácora del asistente (hoy cada usuario solo ve la suya)
- [ ] Definir con Nati quién es Plus y quién Estándar (S11: no hay matriz)

## G6 — Conocimiento
- [x] Subida de PDFs autorizados (admin) directo a Storage privado con URL firmada; extracción por página (unpdf), fragmentos, duplicados por sha256 — `0007_conocimiento.sql`
- [x] Búsqueda híbrida por audiencia (texto en español + pgvector con Reciprocal Rank Fusion); exige 2FA; Estándar no ve documentos "solo Plus"
- [x] Citas en el asistente separadas de los hechos (documento, fuente, fecha, página, enlace al PDF); herramienta `buscar_documentos` para el modelo
- [x] Pantalla Conocimiento: lista por audiencia, subir, retirar/reactivar, reintentar
- [ ] Con `OPENROUTER_API_KEY`: correr `npm run conocimiento:embeddings` y calibrar el umbral de similitud (hoy 0.55) con estudios reales
- [ ] Proyecto alojado: exponer el esquema `conocimiento` en Data API, extensiones `vector` y `unaccent`
- [ ] OCR para PDFs escaneados (hoy se rechazan con un mensaje claro)
- [ ] Procesamiento en segundo plano si llegan PDFs grandes (hoy es síncrono en la acción, límite de tiempo de Vercel)

## G7 — Operación
- [x] Versiones compuestas por mes (`ventas.version_mes`): la carga del mes reemplaza solo ese mes (S8) — `0008_ciclo_mensual.sql`
- [x] Cargas y versiones: subir Excel del mes directo a Storage, validar, alertas, publicar, retirar, conciliar con BI con nota, descartar
- [x] Ingesta compartida entre app y script (`src/lib/cargas/ingesta.ts`); el script queda para el histórico > 50 MB
- [x] Runbook mensual para Insights — `docs/runbook-mensual.md`
- [ ] Hacer que S1 ("sin certificar" ene-2025–ago-2026) salga de los datos: cuando lleguen reexportaciones por mes, quitar la marca de los meses reemplazados
- [ ] Aviso al equipo cuando se publica una versión (correo con Resend)
- [ ] Proyecto alojado: bucket `cargas` (50 MB; el plan gratuito limita a 50 MB por archivo) y `maxDuration` de Vercel ≥ 300 s para procesar y publicar
- [ ] Probar la carga con una exportación mensual real del cubo (hoy probado con archivos ficticios)
- [x] Perfiles y accesos: "Puede publicar versiones" (perfil.es_aprobador) para quien carga sin ser admin
