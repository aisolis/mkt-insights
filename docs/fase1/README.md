# BIA Foresight · Fase 1 — de dónde sale el alcance

Resumen de los dos documentos con que BIA definió el piloto. Los PDF son documentos internos de BIA y **no se guardan en este repositorio**: se piden a Insights.

- `BIA_Foresight_Fase1.pdf` — presentación de la Fase 1 (7 páginas): objetivos, fuentes, etapas con Intelia, hoja de ruta, gobernanza y niveles de acceso.
- `BIA_Foresight_Prototipo_Fase1.pdf` — prototipo (2 páginas): pantalla de Inicio y pantalla del Asistente de IA, con lo que se espera de cada una. Los datos son ficticios.

**Sobre «CONTEXTO».** El código cita un documento `CONTEXTO` con secciones numeradas (`§2` en `src/lib/asistente/alcance.ts`, `§5` en `src/components/version-badge.tsx` y en las migraciones 0003 y 0008). Ese documento no está en el repositorio y **no es ninguno de estos dos PDF**: ninguno tiene secciones numeradas. Lo que sí traen es el contenido al que apuntan esas citas (qué queda fuera del piloto y por qué se concilia con BI), y está resumido abajo. Si el documento `CONTEXTO` original aparece, su resumen va en esta carpeta.

## Qué dicen (resumen fiel, sin interpretar)

### Objetivos de la Fase 1
1. **Ventas confiables.** Validar periodo, cobertura, duplicados y versiones; cifras conciliadas con BI.
2. **Análisis comercial.** Indicadores y comparativos por canal, ruta, territorio, marca, producto o cliente, según permisos.
3. **Asistente conversacional.** Preguntas en lenguaje natural; respuesta con gráfica, fuente, periodo y filtros.
4. **Conocimiento del negocio.** Estudios propios y casos autorizados como contexto para hipótesis y acciones.

Piloto: fuente, el cubo de ventas de BIA; usuarios, Marketing y Ventas; responsable, Insights; datos y métricas, BI.

### Lo que queda para después
«Nielsen, D&N, market share y pronósticos se integran después, con autorización.» Hoja de ruta: Fase 2, conexión directa al cubo y cargas automáticas; Fase 3, fuentes de mercado (Nielsen y D&N, con autorización); Fase 4, nuevas áreas, pronósticos y gobernanza mensual por equipo.

### Por qué se concilia con BI
- La base común es «validación, conciliación con BI y métricas oficiales: **una sola versión de las cifras**».
- Paso 2 del uso: «Conciliar y publicar. BI e Insights revisan contra **la referencia oficial**; una aprobación habilita la versión.»
- La cabecera debe mostrar siempre «versión publicada, fecha de corte y que está conciliada con BI».

### Niveles de acceso
- **Estándar** (gerencias, jefaturas, Marketing y Ventas): ventas por canal, ruta y territorio; desempeño por marca y producto; comparativos contra el periodo anterior; dashboards; asistente dentro de su alcance; solicitud de análisis especiales a Insights.
- **Plus** (Gerencia General, directores, Insights): análisis especializados, detalle por cliente y producto, cruces de datos, mayor alcance según permisos aprobados.

### Lo que se espera del asistente
Cada respuesta incluye tabla o gráfica, explicación, fuente, periodo, filtros, versión y advertencias. «Los cálculos salen de consultas controladas: la IA interpreta, no inventa cifras.» Separa hechos comprobados de hipótesis a validar. Puede citar estudios y casos autorizados. Respeta el perfil: lo que está fuera de alcance se bloquea sin revelar datos.

## Fase 1 frente a lo construido

Revisión del 26-nov-2026, contra `main` más los PR #4 y #5. «Hecho» significa que existe en el código; no que BIA lo haya aceptado.

| Lo que pide la Fase 1 | Estado | Dónde / nota |
|---|---|---|
| Validar periodo, cobertura, duplicados y versiones | Hecho | Cargas y versiones: alertas, versiones por mes, retiro, cuarentena de filas |
| Cifras conciliadas con BI | Hecho el mecanismo; **sin usar con un reporte real** | Control de BI (0021). En `docs/backlog.md` sigue abierto probarlo con un reporte real de BI |
| «Una aprobación habilita la versión» | Hecho | Aprobar y publicar son dos pasos con rol (0020) |
| Conciliar **antes** de publicar | **Distinto** | Hoy se puede publicar sin conciliar, escribiendo el motivo; queda marcada «sin conciliar». Pendiente de decidir con BIA |
| KPIs del periodo contra el anterior y contra el año anterior | Hecho | Inicio |
| Filtros por periodo, canal, territorio/ruta, marca y producto | Hecho, con un matiz | El filtro «Territorio / ruta» filtra por ruta; zona y sucursal existen como apertura de la variación, no como filtro |
| Siempre visible: versión, corte y conciliación | Hecho | Cabecera |
| «Preguntar al asistente» desde cada gráfica con los mismos filtros | Hecho | Inicio → Asistente hereda periodo y filtros |
| Exportar | Hecho | Rutas y tablas del asistente; cada exportación queda en la bitácora |
| Respuesta con tabla o gráfica, fuente, periodo, filtros, versión y advertencias | Hecho | Panel de evidencia y «Ver consulta y datos» |
| La IA interpreta, no inventa cifras | Hecho | Las cifras salen de consultas y se verifican; si no coinciden, se descarta el texto del modelo |
| Hechos comprobados separados de hipótesis | Hecho | En cada respuesta |
| Citar estudios y casos autorizados | Hecho | Conocimiento (PDF, Word, Excel, texto), con dueño, derechos y vigencia |
| Bloquear lo que está fuera de alcance sin revelar datos | Hecho | Lista fija en `alcance.ts` más bloqueos que define un admin |
| Detalle por cliente solo para Plus | **Distinto** | En pantalla, Clientes es solo Plus. En el asistente el detalle por cliente está bloqueado para todos: no se envía a la IA |
| Permisos por perfil y «ámbito de trabajo» | Hecho | Niveles Estándar/Plus y ámbito por empresa, canal o ruta, aplicado en la base |
| Insights y reportes recurrentes | Hecho en parte | Resumen ejecutivo del mes, con envío por correo al publicar |
| Solicitud de análisis especiales a Insights (Estándar) | **No existe** | No hay un flujo en la app |
| Botones «Ver por producto», «Comparar vs. año anterior», «Proponer acciones» | **No existen** | Se logra escribiendo la pregunta; «Proponer acciones» no tiene equivalente |
| «Bajó el número de pedidos» (ejemplo del prototipo) | **Distinto** | El cubo trae facturas, no pedidos: el asistente habla de facturas y bloquea «pedidos» |
| Nielsen, D&N, market share, pronósticos: después, con autorización | Respetado | El asistente no responde esos temas con datos de venta |

Construido además de lo que pide la Fase 1: acceso con 2FA, configurador de columnas del Excel, homologación de canales, reglas y glosario del asistente, bitácora de preguntas con costo, tope de gasto de IA y presupuesto por persona, adjuntos por conversación, informe personal y análisis de precio, volumen y mezcla.

## Dos cosas a tener presentes

- **Estudios de mercado.** Los documentos de Nielsen y de panel de consumo hablan de market share y competencia, que la Fase 1 deja para después y «con autorización». Antes de subirlos a Conocimiento en producción hace falta esa autorización: sus extractos se envían al modelo de IA.
- **El porqué de la conciliación** (`docs/runbook-mensual.md`, sección 5) se escribió deduciéndolo del código. Estos documentos lo respaldan en lo esencial —BI es «la referencia oficial» y el fin es «una sola versión de las cifras»—, pero no dan el ejemplo de la exportación incompleta: ese sigue siendo un razonamiento, no una cita.
