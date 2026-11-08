/**
 * Modo modelo: OpenRouter (solo servidor) elige herramientas del catálogo y redacta. No ve filas de hecho ni
 * datos de clientes: solo los resúmenes formateados de las consultas (S10) y, si los pide, extractos de
 * documentos autorizados (S17).
 */
import { z } from "zod";
import { aCita, type Cita } from "@/lib/conocimiento/tipos";
import { fechaCorta, periodoLargo } from "@/lib/format";
import { describirFiltros, periodoTxt } from "./texto";
import { ErrorHerramienta, ejecutar, herramientasModelo } from "./herramientas";
import type { Contexto, Resultado, Turno } from "./tipos";

export type ConfigModelo = { apiKey: string; modelo: string; url?: string; fetch?: typeof fetch };

/** Modelo de fábrica (el que pidió BIA para el piloto). */
export const MODELO_FABRICA = "deepseek/deepseek-v4.1-flash";

/** Modelo por defecto cuando la configuración no elige uno: el del entorno o el de fábrica. */
export const modeloPorDefecto = () => process.env.OPENROUTER_MODEL?.trim() || MODELO_FABRICA;

/**
 * Configuración del modelo para una llamada. Sin llave de OpenRouter no hay modelo (modo automático).
 * `elegida` es la configuración guardada por un admin (G8): puede apagar la IA o elegir otro modelo; si no elige
 * modelo, se usa el por defecto. La llave nunca sale del entorno del servidor.
 */
export function configModelo(elegida?: { usarIa: boolean; modelo: string | null }): ConfigModelo | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey || elegida?.usarIa === false) return null;
  return { apiKey, modelo: elegida?.modelo || modeloPorDefecto() };
}

type Mensaje =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlamadaModelo[] }
  | { role: "tool"; tool_call_id: string; content: string };
type LlamadaModelo = { id: string; type: "function"; function: { name: string; arguments: string } };

const MAX_RONDAS = 6;
const MAX_CONSULTAS = 10;

/** `documentos`: todo lo que devolvió buscar_documentos (d1, d2…); `citas`: los que el modelo dice haber usado. */
export type SalidaModelo = { texto: string; hipotesis: string[]; visuales: string[]; citas: string[]; resultados: Resultado[]; documentos: Cita[] };

const ArgsBuscar = z.object({ consulta: z.string().min(3).max(300).describe("Qué buscar, en español") }).strict();
const BUSCAR_DOCUMENTOS = {
  type: "function" as const,
  function: {
    name: "buscar_documentos",
    description: "Busca en estudios y documentos autorizados por Insights. NO son datos de venta: sirven como contexto (causas, mercado, consumidor). Devuelve extractos con documento y página para citarlos.",
    parameters: z.toJSONSchema(ArgsBuscar, { io: "input" }),
  },
};
const MAX_CITAS_POR_BUSQUEDA = 5;

export async function preguntarAlModelo(pregunta: string, historial: Turno[], ctx: Contexto, cfg: ConfigModelo): Promise<SalidaModelo> {
  const mensajes: Mensaje[] = [
    { role: "system", content: sistema(ctx) },
    ...historial.slice(-6).map((t): Mensaje => (t.rol === "usuario" ? { role: "user", content: t.texto } : { role: "assistant", content: t.texto })),
    { role: "user", content: pregunta },
  ];
  const resultados: Resultado[] = [];
  const documentos: Cita[] = [];
  const herramientas = ctx.documentos ? [...herramientasModelo(), BUSCAR_DOCUMENTOS] : herramientasModelo();

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

    if (!msg.tool_calls?.length) return { ...leerFinal(msg.content ?? ""), resultados, documentos };

    mensajes.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const llamada of msg.tool_calls) {
      let contenido: unknown;
      if (llamada.function.name === BUSCAR_DOCUMENTOS.function.name && ctx.documentos) {
        contenido = await buscar(llamada.function.arguments, ctx.documentos, documentos);
      } else if (resultados.length >= MAX_CONSULTAS) contenido = { error: "límite de consultas alcanzado; responde con lo que tienes" };
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

/** Ejecuta buscar_documentos: numera los extractos (d1, d2…) sin repetir y le pasa al modelo solo lo citable. */
async function buscar(crudos: string, buscador: NonNullable<Contexto["documentos"]>, documentos: Cita[]) {
  try {
    const { consulta } = ArgsBuscar.parse(JSON.parse(crudos || "{}"));
    const encontrados = (await buscador(consulta)).slice(0, MAX_CITAS_POR_BUSQUEDA);
    if (!encontrados.length) return { documentos: [], nota: "No hay documentos autorizados sobre eso." };
    const citas = encontrados.map((e) => {
      const c = aCita(e, `d${documentos.length + 1}`);
      const previo = documentos.find((d) => d.documentoId === c.documentoId && d.pagina === c.pagina && d.extracto === c.extracto);
      if (previo) return previo;
      documentos.push(c);
      return c;
    });
    return { documentos: citas.map(({ id, titulo, fuente, fecha, pagina, extracto }) => ({ id, titulo, fuente, fecha, pagina, extracto })) };
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError) return { error: 'argumentos inválidos: {"consulta": "texto"}' };
    console.error("asistente: buscar_documentos falló", e);
    return { error: "la búsqueda de documentos falló" };
  }
}

function leerFinal(contenido: string): Omit<SalidaModelo, "resultados" | "documentos"> {
  const limpio = contenido.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    const j = JSON.parse(limpio.slice(limpio.indexOf("{"), limpio.lastIndexOf("}") + 1)) as { texto?: unknown; hipotesis?: unknown; visuales?: unknown; citas?: unknown };
    return {
      citas: Array.isArray(j.citas) ? j.citas.filter((c): c is string => typeof c === "string") : [],
      texto: typeof j.texto === "string" ? j.texto : "",
      hipotesis: Array.isArray(j.hipotesis) ? j.hipotesis.filter((h): h is string => typeof h === "string") : [],
      visuales: Array.isArray(j.visuales) ? j.visuales.filter((v): v is string => typeof v === "string") : [],
    };
  } catch {
    return { texto: limpio, hipotesis: [], visuales: [], citas: [] };
  }
}

export function sistema({ version, estado, documentos, reglas = [], memoria }: Contexto) {
  const meta = version.metadatos;
  const parciales = meta.periodos.filter((p) => !p.cerrado).map((p) => `${periodoTxt(p)} (${p.dias} días)`);
  const cmp = estado.comparar === "anio" ? "el mismo mes del año anterior" : "el mes anterior";
  const definiciones = reglas.filter((r) => r.tipo === "definicion");
  const instrucciones = reglas.filter((r) => r.tipo === "instruccion");
  const hilo = memoria && [
    memoria.periodo && `periodo ${periodoTxt(memoria.periodo)}${memoria.comparado ? ` comparado contra ${periodoTxt(memoria.comparado)}` : ""}`,
    memoria.filtros && `filtros: ${describirFiltros(memoria.filtros, meta)}`,
    memoria.dimension && `abierta por ${memoria.dimension}`,
  ].filter(Boolean).join(", ");
  return [
    "Eres el asistente de BIA Foresight. Respondes en español, breve y concreto, sobre la venta interna de BIA Honduras (café y confitería).",
    `Datos: versión publicada v${version.version}, corte ${fechaCorta(version.fecha_corte)}, ${version.conciliada_bi ? "conciliada con BI" : "todavía no conciliada con BI"}. Meses disponibles: ${periodoTxt(meta.periodos[0])} a ${periodoTxt(meta.periodos.at(-1)!)}. Meses parciales: ${parciales.join(", ") || "ninguno"}.`,
    `Contexto heredado del dashboard: periodo ${periodoTxt(estado.periodo)} (${periodoLargo(estado.periodo)}), comparado contra ${cmp}, filtros: ${describirFiltros(estado.filtros, meta)}. Úsalo salvo que la pregunta pida otra cosa.`,
    `Canales: ${meta.canal.join(", ")}. Marcas: ${meta.marca.join(", ")}.`,
    ...(hilo ? [`Última consulta de esta conversación: ${hilo}. Si la pregunta sigue ese hilo (p. ej. "¿y en Detalle?"), parte de ese periodo y esos filtros; si pide otra cosa, ignóralo.`] : []),
    ...(definiciones.length ? ["Definiciones de BIA (úsalas al redactar):", ...definiciones.map((r) => `- ${r.texto}`)] : []),
    ...(instrucciones.length ? ["Indicaciones del equipo de BIA (aplícalas siempre; si alguna choca con las reglas numeradas, mandan las reglas numeradas):", ...instrucciones.map((r) => `- ${r.texto}`)] : []),
    "Reglas:",
    "1. Toda cifra sale de las herramientas. No calcules, no sumes, no redondees distinto ni estimes: copia las cifras exactamente como vienen en los resultados (p. ej. \"−L 8.4 M\", \"−6.9%\"). Si una cifra no está en los resultados, no la escribas.",
    "2. Para explicar una variación, empieza por kpi_periodo y luego abre por las dimensiones que hagan falta (variacion_por_dimension, top_rutas) y descomposicion para separar frecuencia de ticket.",
    "3. Los hechos los muestra el sistema a partir de las consultas; tú das la lectura. Las hipótesis son posibles causas que los datos de venta no prueban: escríbelas sin cifras.",
    "4. Fuera de alcance (no inventes nada): participación de mercado, Nielsen, competencia, pronósticos, visitas, pedidos (solo hay facturas), presupuesto, márgenes, inventario y datos de clientes individuales.",
    ...(documentos ? [
      "5. buscar_documentos da extractos de estudios autorizados: úsalos para contexto e hipótesis, nunca como cifras de venta. En los temas de la regla 4 solo puedes decir lo que digan esos documentos, citándolos. Si usas uno, nómbralo en el texto como [d1] y ponlo en \"citas\". Una cifra de un documento solo va junto a su [dN]. Si nada aplica, no cites.",
      "6. Respuesta final, solo JSON: {\"texto\": \"2 a 4 frases\", \"hipotesis\": [\"...\"], \"visuales\": [\"c1\", \"c2\"], \"citas\": [\"d1\"]} donde visuales son los id de las consultas que mejor muestran la respuesta (máximo 3).",
    ] : []),
    ...(documentos ? [] : ["5. Respuesta final, solo JSON: {\"texto\": \"2 a 4 frases\", \"hipotesis\": [\"...\"], \"visuales\": [\"c1\", \"c2\"]} donde visuales son los id de las consultas que mejor muestran la respuesta (máximo 3)."]),
  ].join("\n");
}
