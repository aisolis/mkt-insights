/**
 * Glosario del asistente: términos de BIA con sinónimos y definición. A diferencia de las reglas de tipo
 * `definicion` (van siempre en las instrucciones), del glosario solo se envían al modelo las definiciones cuyos
 * términos aparecen en la pregunta: el glosario puede crecer sin alargar cada llamada.
 * Este archivo es puro (sin base ni servidor) para que lo usen el asistente, la página y las pruebas.
 */
import { z } from "zod";
import { SIGNOS_BLOQUEO } from "./alcance";
import { normalizar } from "./texto";

export type TerminoGlosario = { id: string; termino: string; sinonimos: string[]; definicion: string };

/** Igual que interno.tope_glosario() (0030). */
export const TOPE_GLOSARIO = 1000;
export const MAX_SINONIMOS = 20;
/** Definiciones que se envían como máximo en una pregunta: acota lo que el glosario agrega al prompt. */
export const MAX_TERMINOS_POR_PREGUNTA = 8;

/** Misma limpieza que los bloqueos: sin tildes, mayúsculas ni signos. */
const limpiar = (s: string) => normalizar(s).replace(SIGNOS_BLOQUEO, " ").replace(/\s+/g, " ").trim();

/** El nombre aparece como palabra o frase completa; se acepta su plural simple («ruta» encuentra «rutas»). */
function aparece(texto: string, nombre: string) {
  return texto.includes(` ${nombre} `) || texto.includes(` ${nombre}s `) || texto.includes(` ${nombre}es `);
}

/**
 * Términos del glosario que aparecen en los textos. `textos[0]` es la pregunta; los siguientes (p. ej. la pregunta
 * anterior de la conversación) sirven para preguntas que siguen el hilo y pesan menos. Dentro de cada texto van
 * primero los nombres más largos («venta neta» antes que «venta»). Como máximo `max`.
 */
export function terminosEnPregunta(textos: string[], glosario: TerminoGlosario[], max = MAX_TERMINOS_POR_PREGUNTA): TerminoGlosario[] {
  const limpios = textos.map((t) => ` ${limpiar(t)} `);
  const hallados: { termino: TerminoGlosario; texto: number; largo: number }[] = [];
  for (const termino of glosario) {
    let mejor: { texto: number; largo: number } | null = null;
    for (const nombre of [termino.termino, ...termino.sinonimos]) {
      const n = limpiar(nombre);
      if (n.length < 2) continue;
      const texto = limpios.findIndex((t) => aparece(t, n));
      if (texto < 0) continue;
      if (!mejor || texto < mejor.texto || (texto === mejor.texto && n.length > mejor.largo)) mejor = { texto, largo: n.length };
    }
    if (mejor) hallados.push({ termino, ...mejor });
  }
  return hallados
    .sort((a, b) => a.texto - b.texto || b.largo - a.largo || a.termino.termino.localeCompare(b.termino.termino, "es"))
    .slice(0, max)
    .map((h) => h.termino);
}

/** La viñeta que recibe el modelo: «- Ticket (también: ticket promedio): venta neta / facturas.» */
export function lineaGlosario(t: Pick<TerminoGlosario, "termino" | "sinonimos" | "definicion">) {
  return `- ${t.termino}${t.sinonimos.length ? ` (también: ${t.sinonimos.join(", ")})` : ""}: ${t.definicion}`;
}

const unaLinea = (s: string) => s.replace(/\s+/g, " ").trim();

/** Sinónimos limpios: una línea, sin vacíos ni repetidos (sin tildes ni mayúsculas) y sin el propio término. */
export function normalizarSinonimos(sinonimos: string[], termino = ""): string[] {
  const vistos = new Set<string>([limpiar(termino)]);
  const salida: string[] = [];
  for (const s of sinonimos) {
    const texto = unaLinea(s), clave = limpiar(texto);
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(texto);
  }
  return salida;
}

export const EntradaTermino = z.object({
  termino: z.string().transform(unaLinea).pipe(z.string().min(2, "El término debe tener al menos 2 caracteres.").max(80, "El término no puede pasar de 80 caracteres.")),
  sinonimos: z.array(z.string()).default([]),
  // Una sola línea: va como viñeta en las instrucciones y no puede imitar su estructura.
  definicion: z.string().transform(unaLinea).pipe(z.string().min(3, "Escribe la definición (al menos 3 caracteres).").max(500, "La definición no puede pasar de 500 caracteres.")),
}).transform((t) => ({ ...t, sinonimos: normalizarSinonimos(t.sinonimos, t.termino) }))
  .superRefine((t, c) => {
    if (!limpiar(t.termino)) c.addIssue({ code: "custom", message: "El término necesita al menos una letra o un número." });
    if (t.sinonimos.length > MAX_SINONIMOS) c.addIssue({ code: "custom", message: `Un término admite hasta ${MAX_SINONIMOS} sinónimos.` });
    const malo = t.sinonimos.find((s) => s.length < 2 || s.length > 80);
    if (malo) c.addIssue({ code: "custom", message: `«${malo}»: cada sinónimo debe tener entre 2 y 80 caracteres.` });
  });
export type EntradaTermino = z.input<typeof EntradaTermino>;
export type TerminoValido = z.output<typeof EntradaTermino>;

/** Parte «a, b; c» o un sinónimo por línea. */
export const partirSinonimos = (texto: string) => texto.split(/[\n,;|]/);
