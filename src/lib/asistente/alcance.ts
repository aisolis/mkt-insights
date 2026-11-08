/**
 * Fuera de alcance: se bloquea antes de consultar datos o llamar al modelo, y la respuesta no lleva cifras.
 * Lista cerrada de temas que el cubo de ventas no contiene o que el piloto no expone (CONTEXTO §2, S10).
 */
import { normalizar } from "./texto";
import type { ReglaAsistente } from "./tipos";

/** `documentos`: el tema no está en el cubo, pero un estudio autorizado puede dar contexto (G6). Los datos
 * personales y el detalle por cliente no se responden ni con documentos. */
type Regla = { patron: RegExp; motivo: string; documentos: boolean };

const REGLAS: Regla[] = [
  { patron: /\b(market share|share|participacion de mercado|cuota de mercado|nielsen|d ?& ?n|competencia|competidor(es)?|la marca rival)\b/,
    motivo: "Participación de mercado, Nielsen y competencia están fuera del piloto: el cubo solo tiene la venta interna de BIA.", documentos: true },
  { patron: /\b(pronostic\w*|proyecc\w*|proyectar|proyectad[oa]s?|forecast|predic\w*|vamos a vender|venderemos|cuanto se vendera|proximo (mes|ano|trimestre)|el mes que viene)\b/,
    motivo: "Los pronósticos están fuera del piloto: el asistente responde sobre venta ya facturada.", documentos: true },
  { patron: /\b(visita(s)?|visitad\w*|frecuencia de visita)\b/,
    motivo: "El cubo no registra visitas de venta. Puedo responder sobre clientes con compra y facturas.", documentos: true },
  { patron: /\b(pedido(s)?|orden(es)? de compra)\b/,
    motivo: "El cubo registra facturas, no pedidos. Puedo responder sobre facturas y ticket por factura.", documentos: true },
  { patron: /\b(presupuesto|meta(s)? de venta|cumplimiento de meta|cuota de venta|objetivo de venta)\b/,
    motivo: "El cubo no trae presupuesto ni metas de venta.", documentos: true },
  { patron: /\b(margen(es)?|rentabilidad|utilidad|costo(s)?|ganancia(s)?)\b/,
    motivo: "El cubo no trae costos, así que no hay margen ni rentabilidad.", documentos: true },
  { patron: /\b(inventario|existencias|stock|quiebre(s)? de (stock|inventario))\b/,
    motivo: "El cubo no trae inventario.", documentos: true },
  { patron: /\b(cedula(s)?|subgrupo|dni|identidad|telefono|direccion del cliente)\b/,
    motivo: "Los datos personales no se consultan desde el asistente.", documentos: false },
  { patron: /\b((que|cuales|quienes|lista( de)?|top|principales|mayores|nombre(s)? de( los)?)\s+(\w+\s+)?clientes?|clientes? que (mas|menos|dejaron|perdimos|se perdieron|compraron)|cliente\s+\S+\s+(compro|vendio))/,
    motivo: "El detalle por cliente no se envía al modelo de IA (S10). Puedo responder con totales: clientes con compra, facturas y ticket.", documentos: false },
];

/** La regla que deja la pregunta fuera del cubo; null si se puede responder con datos de venta. */
export function reglaFueraDeAlcance(pregunta: string): Omit<Regla, "patron"> | null {
  const t = normalizar(pregunta).replace(/[¿?¡!.,;:()"]/g, " ");
  // "¿cuántos clientes compraron?" es un total permitido; solo se revisan los demás temas.
  const total = /\bcuant[oa]s clientes\b|clientes con compra/.test(t) && !/\b(que|cuales|quienes) clientes\b/.test(t);
  const r = (total ? REGLAS.slice(0, -1) : REGLAS).find((x) => x.patron.test(t));
  return r ? { motivo: r.motivo, documentos: r.documentos } : null;
}

/** Signos que separan palabras al comparar bloqueos (pregunta y términos se limpian igual). */
export const SIGNOS_BLOQUEO = /[¿?¡!.,;:()"«»'“”‘’/\-]/g;
const limpiarBloqueo = (s: string) => normalizar(s).replace(SIGNOS_BLOQUEO, " ").replace(/\s+/g, " ").trim();

/**
 * Bloqueos definidos por un admin (G8): si la pregunta contiene alguno de los términos de una regla de tipo
 * `bloqueo` (sin tildes ni mayúsculas, como palabra o frase completa), se responde con su motivo y sin cifras ni
 * documentos. Se aplica antes que las reglas fijas.
 */
export function reglaBloqueo(pregunta: string, reglas: ReglaAsistente[] = []): Omit<Regla, "patron"> | null {
  const t = ` ${limpiarBloqueo(pregunta)} `;
  const r = reglas.find((x) => x.tipo === "bloqueo" && x.terminos.some((term) => {
    const n = limpiarBloqueo(term);
    return n.length > 0 && t.includes(` ${n} `);
  }));
  return r ? { motivo: r.texto, documentos: false } : null;
}

/** Devuelve el motivo si la pregunta está fuera de alcance; null si se puede responder. */
export function fueraDeAlcance(pregunta: string): string | null {
  return reglaFueraDeAlcance(pregunta)?.motivo ?? null;
}
