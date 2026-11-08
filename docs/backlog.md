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
- [x] Modo modelo probado con `deepseek/deepseek-v4.1-flash` (modelo por defecto, pedido por BIA): 10/10 preguntas del banco con texto del modelo y cifras verificadas, 3–14 s por respuesta — `npm run banco:modelo`

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
- [x] Búsqueda semántica probada con `baai/bge-m3`: umbral 0.50 (relacionadas 0.53–0.63, no relacionadas 0.36–0.46, con un estudio ficticio)
- [ ] Recalibrar el umbral con estudios reales de BIA
- [ ] Proyecto alojado: exponer el esquema `conocimiento` en Data API, extensiones `vector` y `unaccent`
- [ ] OCR para PDFs escaneados (hoy se rechazan con un mensaje claro)
- [ ] Procesamiento en segundo plano si llegan PDFs grandes (hoy es síncrono en la acción, límite de tiempo de Vercel)

## G7 — Operación
- [x] Versiones compuestas por mes (`ventas.version_mes`): la carga del mes reemplaza solo ese mes (S8) — `0008_ciclo_mensual.sql`
- [x] Cargas y versiones: subir Excel del mes directo a Storage, validar, alertas, publicar, retirar, conciliar con BI con nota, descartar
- [x] Ingesta compartida entre app y script (`src/lib/cargas/ingesta.ts`); el script queda para el histórico > 50 MB
- [x] Runbook mensual para Insights — `docs/runbook-mensual.md`
- [x] S1 revisado con el resumen trimestral de BIA: "sin certificar" solo ene–jun 2025 — `docs/revision-data-intelia.md`
- [ ] Hacer que la marca "sin certificar" salga de los datos cuando lleguen reexportaciones por mes
- [ ] Aviso al equipo cuando se publica una versión (correo con Resend)
- [ ] Proyecto alojado: bucket `cargas` (50 MB; el plan gratuito limita a 50 MB por archivo) y `maxDuration` de Vercel ≥ 300 s para procesar y publicar
- [x] Carga probada con la exportación real de octubre 2026 (61,754 líneas en 31 s, sin publicar): libros con hojas de resumen se cargan saltando esas hojas, con alerta
- [ ] Homologar SEMI-MAYOREO y PENDIENTE (aparecen en octubre) y publicar octubre
- [ ] Confirmar con BIA si la hoja de septiembre por canal es el reporte oficial de BI y qué canal manda cuando línea y ruta difieren
- [x] Perfiles y accesos: "Puede publicar versiones" (perfil.es_aprobador) para quien carga sin ser admin

## G8 — Asistente: conversaciones y reglas
- [x] Pantalla del asistente al estilo explorador de datos: inicio con sugerencias, resultados en gráfico o tabla, consulta con sus datos en tabla
- [x] Conversaciones por usuario (`ventas.conversacion`, RLS): lista lateral, renombrar, archivar, enlace `?c=`; aviso a las 20 preguntas — `0010_conversaciones.sql`
- [x] Memoria acotada: el servidor arma el historial desde la base (últimos 3 turnos = 6 mensajes) y la memoria estructurada de la última consulta (periodo, filtros, dimensión), acotada a valores de la versión vigente
- [x] Reglas del asistente administradas por admin (`/asistente/reglas`): instrucción, definición y bloqueo; tope de 30 activas; bitácora de cambios; cada respuesta registra las reglas activas — `0011_reglas_asistente.sql`
- [x] La bitácora del asistente la escribe solo el servidor (service_role); el usuario ya no puede insertar filas — `0012_bitacora_servidor.sql`
- [x] Bitácora del asistente para admin (`/asistente/bitacora`): resumen, filtros por periodo, resultado y persona; detalle con la respuesta que vio la persona y las reglas activas en ese momento
- [x] Vista en celular: menú desplegable, encabezado compacto, panel de conversaciones como cajón
- [x] Configuración del asistente (`/asistente/configuracion`, solo admin): pestañas Modelo de IA, Reglas y Bitácora en un solo lugar
- [x] Elegir el modelo de OpenRouter desde la app (catálogo en vivo, solo modelos con herramientas, precios por millón), apagar la IA, probar un modelo con una pregunta sin guardarlo; historial de cambios — `0013_config_asistente.sql`. `OPENROUTER_MODEL` queda como modelo por defecto
- [ ] Proyecto alojado: revisar en OpenRouter la política de datos de los proveedores habilitados antes de producción

## G9 — Asistente
- [x] Valoración de cada respuesta (👍/👎 con comentario opcional), en el chat y en las conversaciones guardadas; solo el dueño del turno (lo comprueba la base); en la Bitácora: columna, filtro «Con 👎 / Con 👍», detalle y resumen — `0017_asistente_uso.sql`
- [x] Costo por pregunta: tokens y costo en dólares que informa OpenRouter, sumados en todas las rondas de herramientas (sin costo informado se estima con los precios del catálogo); por pregunta, total del periodo y por modelo en la Bitácora; «Gasto de IA este mes» en Modelo de IA
- [x] Tope de gasto mensual opcional (Modelo de IA, con historial): al llegar, el asistente responde con el análisis automático con aviso y la pregunta queda marcada; «Probar» también se frena y su costo cuenta para el tope
- [x] `OPENROUTER_MODELOS_PERMITIDOS` (opcional, ids exactos o `proveedor/*`): el catálogo, guardar y probar solo aceptan esos; un modelo configurado fuera de la lista responde en automático con aviso
- [x] Informe personal (`/informe`): «Agregar al informe» en cada respuesta; ordenar, quitar, título y nota; «Imprimir o guardar PDF» con la evidencia de cada respuesta (versión, corte, advertencias); solo lo propio
- [ ] Menú: entrada «Informe» (`/informe`)
- [ ] Proyecto alojado: aplicar `0017_asistente_uso.sql` y decidir tope mensual y lista de modelos permitidos con BIA

## G9 — Dashboard
- [x] Vistas guardadas en la barra de filtros (botón "Vistas"): aplicar, guardar los filtros de ahora con periodo fijo o "siempre el último mes", renombrar, borrar y compartir con el equipo (se ve quién la creó); solo parámetros conocidos — `0018_vistas.sql`

## G9 — Operación
- [x] Homologación de canales desde la app (`/cargas/homologacion`, admin o aprobador): equivalencias, canales sin homologar con sus ventas, agregar/cambiar/quitar con bitácora; se re-aplica a las cargas validadas sin publicar, nunca a lo publicado (S19) — `0016_operacion.sql`
- [x] Alertas por canal antes de publicar: contra lo publicado del mismo mes (> 5 %) o el promedio de los 3 meses anteriores (> 25 %), sin canales chicos (S20)
- [x] Resumen ejecutivo del mes (`/resumen?version=N&periodo=YYYY-MM`): KPI contra mes anterior y año anterior, canales/rutas/marcas que explican la variación, advertencias; imprimible o PDF; enlazado al publicar y en cada versión (S21)
- [x] Correo opcional al publicar con el resumen (Resend, `src/lib/correo.ts`); solo en producción, en desarrollo queda en el log
- [ ] Proyecto alojado: configurar `RESEND_API_KEY` y `RESEND_FROM` (dominio verificado en Resend) y probar un envío real con una lista corta
- [ ] Menú: entrada «Resumen del mes» (`/resumen`)
- [ ] Homologar SEMI-MAYOREO y PENDIENTE cuando BIA decida (desde la app; octubre se corrige volviendo a subirlo y publicarlo)

## G9 — Clientes (Plus)
- [x] Pantalla Clientes (`/clientes`, solo Plus): activos, nuevos, recuperados, siguen comprando, en riesgo y perdidos con sus ventas; reparto por ruta principal; lista por estado paginada con última compra y exportación CSV (`/api/clientes`); la base exige Plus (S22) — `0015_clientes.sql`
- [ ] Confirmar con Nati el umbral de "en riesgo" (hoy caída > 50 % contra el periodo comparado) y si "nuevo" debe mirar más de un año atrás cuando llegue más historia

## G9 — Análisis comercial
- [x] Puente precio–volumen–mezcla entre el mes y su comparado, con los filtros del dashboard: volumen, precio, mezcla, productos nuevos, que dejaron de venderse y ajustes sin kg; cuadra al centavo con la variación (S23) — `0014_analisis.sql`
- [x] Sección "Precio, volumen y mezcla" en el dashboard: cascada de la variación y productos con más efecto precio y mezcla
- [x] Acumulado del año (enero..mes contra el mismo tramo del año anterior): venta neta, volumen, precio por kg y clientes con compra, con advertencias de meses parciales, faltantes y sin certificar (S24)
- [x] Rutas fuera de lo normal: cambio del mes contra el anterior frente a los 12 meses previos de cada ruta (mediana y desviación robusta, sin rutas chicas), con el motivo en palabras (S25)
- [x] Asistente: herramientas `puente_precio_volumen_mezcla`, `acumulado_anio` y `rutas_atipicas`, con hechos verificables y disparadores en modo automático ("precio o volumen", "mezcla", "en lo que va del año", "acumulado", "YTD", "fuera de lo normal", "atípicas")
- [ ] Asistente: pregunta sugerida al llegar desde las secciones nuevas (`?sobre=acumulado|precio|atipicas`) y una línea en las instrucciones del modelo sobre las herramientas nuevas
- [ ] Confirmar con Nati el umbral de rutas fuera de lo normal (|puntaje| ≥ 3.5, rutas ≥ 0.1 % del promedio) después de revisarlo un par de meses
- [ ] Proyecto alojado: aplicar `0014_analisis.sql`
