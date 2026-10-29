# Banco de preguntas del asistente (G4)

Se corre con `npm test` contra la versión publicada en el Supabase local (`tests/asistente-banco.test.ts`), en modo determinista. Contexto: el del dashboard por defecto (septiembre 2026 vs. agosto 2026, sin filtros). En toda respuesta dentro de alcance se exige: evidencia con versión y cálculo, hipótesis sin cifras y ningún dato de cliente o subgrupo.

| # | Pregunta | Qué debe pasar |
|---|---|---|
| 1 | ¿Dónde se concentra la caída de septiembre? | −6.9 % vs. agosto; concentra en Mayoreo; consulta KPI, descomposición, canal, rutas y marca |
| 2 | ¿Por qué cayó la venta neta vs. agosto? | "vs. agosto" es el comparado; hechos con ticket por factura −6.2 %; al menos una hipótesis |
| 3 | ¿Qué rutas explican la caída? | Usa top_rutas (ruta × canal) |
| 4 | ¿Cómo le fue a la marca ORO en septiembre? | Filtro marca ORO |
| 5 | Variación por canal en septiembre vs. el año anterior | Compara contra septiembre 2025 |
| 6 | ¿Cuánto vendimos en agosto 2026? | Solo KPI; L 150.5 M |
| 7 | Evolución mensual de 2025 | Serie 2025 con 2024 de referencia (sin datos, con aviso) |
| 8 | ¿Qué productos cayeron más en Mayoreo? | Filtro canal Mayoreo, abre por producto |
| 9 | ¿Bajó el número de facturas o el ticket? | Usa la descomposición |
| 10 | Variación por zona | La caída se concentra en ZC |
| 11 | ¿Cuál es nuestro market share en café? | Fuera de alcance, sin cifras ni consultas |
| 12 | ¿Cuánto vamos a vender en noviembre? | Fuera de alcance (pronóstico) |
| 13 | ¿Cuántas visitas hicimos en la ruta 127? | Fuera de alcance (no hay visitas) |
| 14 | ¿Cuántos pedidos hubo en septiembre? | Fuera de alcance (hay facturas, no pedidos) |
| 15 | ¿Qué clientes dejaron de comprar? | Fuera de alcance (detalle por cliente, S10) |

Pendiente: correr el mismo banco en modo modelo cuando haya `OPENROUTER_API_KEY`, revisando a mano la lectura y las hipótesis.
