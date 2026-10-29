# Supuestos de arranque (vigentes hasta que BIA diga lo contrario)

| ID | Supuesto | Origen del vacío | Impacto si cambia |
|---|---|---|---|
| S1 | Hoja 1 (1,000,000 filas) puede estar truncada; ene-2025→ago-2026 se marca "sin certificar" hasta reexportación | Conteo exacto redondo | Totales históricos |
| S2 | Canales se homologan a 6 valores con `supabase/seed/homologacion_canal.csv`; Grupo y Subgrupo igual | 18 variantes de escritura | Agregados por canal |
| S3 | Duplicados exactos y 153 discrepancias se conservan y se marcan con flag | Sin regla de BI | Totales ±L 384 k |
| S4 | Cliente con compra = venta neta > 0 en periodo, clave (empresa, código) | Sin definición | KPI 4 |
| S5 | Precio promedio = Σ venta neta / Σ kg | Sin definición | KPI 3 |
| S6 | Moneda HNL para todo; GKSA y MCM se suman | Diccionario dice "moneda local" | Consolidado |
| S7 | Un mes está "cerrado" si no es el mes de la fecha máxima del archivo | Sin metadato de cierre | Comparaciones |
| S8 | Carga mensual = snapshot que reemplaza ese mes | Sin regla de actualización | Doble conteo |
| S9 | Fechas numéricas = serial Excel (epoch 1899-12-30); códigos se guardan como texto | Tipos mixtos | Integridad |
| S10 | Subgrupo no se envía al modelo de IA (contiene cédulas) | Datos personales | Privacidad |
| S11 | Usuarios: Nati Plus+admin; resto por invitación | Sin matriz | Acceso |
| S12 | Dimensiones expuestas en piloto: periodo, empresa, canal, ruta, zona, sucursal, marca, producto, cliente (solo Plus) | Prototipo | UI |
| S13 | Cobertura = rutas con alguna línea en el periodo (con los filtros aplicados) / rutas distintas en la versión | El prototipo muestra "cobertura X/Y rutas" sin definirla | Pie del dashboard y evidencia del asistente |
| S14 | Factura = documento (empresa, nº) con venta neta sumada > 0 en el periodo; ticket = Σ venta neta / facturas. El cubo no tiene pedidos ni visitas | El prototipo habla de "pedidos" y "ticket" | Descomposición del asistente; "pedidos" y "visitas" quedan fuera de alcance |
| S15 | El asistente envía al modelo (OpenRouter) solo agregados ya formateados por periodo, canal, ruta, marca, producto, zona, sucursal o empresa; nunca filas, clientes ni subgrupo. Las cifras que escriba el modelo deben aparecer en esas consultas o se descarta su texto | La IA "interpreta, no inventa" | Privacidad y confianza en las respuestas |
