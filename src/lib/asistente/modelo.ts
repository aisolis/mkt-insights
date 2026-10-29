/**
 * Modo modelo: OpenRouter (solo servidor) elige herramientas del catálogo y redacta. No ve filas de hecho ni
 * datos de clientes: solo los resúmenes formateados de las consultas (S10).
 */
import { fechaCorta, periodoLargo } from "@/lib/format";
import { describirFiltros, periodoTxt } from "./texto";
import { ErrorHerramienta, ejecutar, herramientasModelo } from "./herramientas";
import type { Contexto, Resultado, Turno } from "./tipos";

export type ConfigModelo = { apiKey: string; modelo: string; url?: string; fetch?: typeof fetch };

export function configModelo(): ConfigModelo | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  return apiKey ? { apiKey, modelo: process.env.OPENROUTER_MODEL?.trim() || "anthropic/claude-sonnet-4.5" } : null;
}

type Mensaje =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlamadaModelo[] }
  | { role: "tool"; tool_call_id: string; content: string };
type LlamadaModelo = { id: string; type: "function"; function: { name: string; arguments: string } };

const MAX_RONDAS = 6;
const MAX_CONSULTAS = 10;

export type SalidaModelo = { texto: string; hipotesis: string[]; visuales: string[]; resultados: Resultado[] };

export async function preguntarAlModelo(pregunta: string, historial: Turno[], ctx: Contexto, cfg: ConfigModelo): Promise<SalidaModelo> {
  const mensajes: Mensaje[] = [
    { role: "system", content: sistema(ctx) },
    ...historial.slice(-6).map((t): Mensaje => (t.rol === "usuario" ? { role: "user", content: t.texto } : { role: "assistant", content: t.texto })),
    { role: "user", content: pregunta },
  ];
  const resultados: Resultado[] = [];
  const herramientas = herramientasModelo();

  for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
    const res = await (cfg.fetch ?? fetch)(cfg.url ?? "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "X-Title": "BIA Foresight" },
      body: JSON.stringify({ model: cfg.modelo, messages: mensajes, tools: herramientas, tool_choice: "auto", temperature: 0.2 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: { message: { content: string | null; tool_calls?: LlamadaModelo[] } }[] };
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error("OpenRouter: respuesta sin mensaje");

    if (!msg.tool_calls?.length) return { ...leerFinal(msg.content ?? ""), resultados };

    mensajes.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const llamada of msg.tool_calls) {
      let contenido: unknown;
      if (resultados.length >= MAX_CONSULTAS) contenido = { error: "límite de consultas alcanzado; responde con lo que tienes" };
      else {
        try {
          const r = await ejecutar(llamada.function.name, JSON.parse(llamada.function.arguments || "{}"), ctx, `c${resultados.length + 1}`);
          resultados.push(r);
          contenido = { id: r.id, resumen: r.resumen, hechos: r.hechos };
        } catch (e) {
          if (!(e instanceof ErrorHerramienta) && !(e instanceof SyntaxError)) throw e;
          contenido = { error: e.message };
        }
      }
      mensajes.push({ role: "tool", tool_call_id: llamada.id, content: JSON.stringify(contenido) });
    }
  }
  throw new Error("el modelo no terminó en el número máximo de rondas");
}

function leerFinal(contenido: string): Omit<SalidaModelo, "resultados"> {
  const limpio = contenido.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    const j = JSON.parse(limpio.slice(limpio.indexOf("{"), limpio.lastIndexOf("}") + 1)) as { texto?: unknown; hipotesis?: unknown; visuales?: unknown };
    return {
      texto: typeof j.texto === "string" ? j.texto : "",
      hipotesis: Array.isArray(j.hipotesis) ? j.hipotesis.filter((h): h is string => typeof h === "string") : [],
      visuales: Array.isArray(j.visuales) ? j.visuales.filter((v): v is string => typeof v === "string") : [],
    };
  } catch {
    return { texto: limpio, hipotesis: [], visuales: [] };
  }
}

function sistema({ version, estado }: Contexto) {
  const meta = version.metadatos;
  const parciales = meta.periodos.filter((p) => !p.cerrado).map((p) => `${periodoTxt(p)} (${p.dias} días)`);
  const cmp = estado.comparar === "anio" ? "el mismo mes del año anterior" : "el mes anterior";
  return [
    "Eres el asistente de BIA Foresight. Respondes en español, breve y concreto, sobre la venta interna de BIA Honduras (café y confitería).",
    `Datos: versión publicada v${version.version}, corte ${fechaCorta(version.fecha_corte)}, ${version.conciliada_bi ? "conciliada con BI" : "todavía no conciliada con BI"}. Meses disponibles: ${periodoTxt(meta.periodos[0])} a ${periodoTxt(meta.periodos.at(-1)!)}. Meses parciales: ${parciales.join(", ") || "ninguno"}.`,
    `Contexto heredado del dashboard: periodo ${periodoTxt(estado.periodo)} (${periodoLargo(estado.periodo)}), comparado contra ${cmp}, filtros: ${describirFiltros(estado.filtros, meta)}. Úsalo salvo que la pregunta pida otra cosa.`,
    `Canales: ${meta.canal.join(", ")}. Marcas: ${meta.marca.join(", ")}.`,
    "Reglas:",
    "1. Toda cifra sale de las herramientas. No calcules, no sumes, no redondees distinto ni estimes: copia las cifras exactamente como vienen en los resultados (p. ej. \"−L 8.4 M\", \"−6.9%\"). Si una cifra no está en los resultados, no la escribas.",
    "2. Para explicar una variación, empieza por kpi_periodo y luego abre por las dimensiones que hagan falta (variacion_por_dimension, top_rutas) y descomposicion para separar frecuencia de ticket.",
    "3. Los hechos los muestra el sistema a partir de las consultas; tú das la lectura. Las hipótesis son posibles causas que los datos de venta no prueban: escríbelas sin cifras.",
    "4. Fuera de alcance (no inventes nada): participación de mercado, Nielsen, competencia, pronósticos, visitas, pedidos (solo hay facturas), presupuesto, márgenes, inventario y datos de clientes individuales.",
    "5. Respuesta final, solo JSON: {\"texto\": \"2 a 4 frases\", \"hipotesis\": [\"...\"], \"visuales\": [\"c1\", \"c2\"]} donde visuales son los id de las consultas que mejor muestran la respuesta (máximo 3).",
  ].join("\n");
}
