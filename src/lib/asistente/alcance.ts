/**
 * Fuera de alcance: se bloquea antes de consultar datos o llamar al modelo, y la respuesta no lleva cifras.
 * Lista cerrada de temas que el cubo de ventas no contiene o que el piloto no expone (CONTEXTO §2, S10).
 */
import { normalizar } from "./texto";

type Regla = { patron: RegExp; motivo: string };

const REGLAS: Regla[] = [
  { patron: /\b(market share|share|participacion de mercado|cuota de mercado|nielsen|d ?& ?n|competencia|competidor(es)?|la marca rival)\b/,
    motivo: "Participación de mercado, Nielsen y competencia están fuera del piloto: el cubo solo tiene la venta interna de BIA." },
  { patron: /\b(pronostic\w*|proyecc\w*|proyectar|proyectad[oa]s?|forecast|predic\w*|vamos a vender|venderemos|cuanto se vendera|proximo (mes|ano|trimestre)|el mes que viene)\b/,
    motivo: "Los pronósticos están fuera del piloto: el asistente responde sobre venta ya facturada." },
  { patron: /\b(visita(s)?|visitad\w*|frecuencia de visita)\b/,
    motivo: "El cubo no registra visitas de venta. Puedo responder sobre clientes con compra y facturas." },
  { patron: /\b(pedido(s)?|orden(es)? de compra)\b/,
    motivo: "El cubo registra facturas, no pedidos. Puedo responder sobre facturas y ticket por factura." },
  { patron: /\b(presupuesto|meta(s)? de venta|cumplimiento de meta|cuota de venta|objetivo de venta)\b/,
    motivo: "El cubo no trae presupuesto ni metas de venta." },
  { patron: /\b(margen(es)?|rentabilidad|utilidad|costo(s)?|ganancia(s)?)\b/,
    motivo: "El cubo no trae costos, así que no hay margen ni rentabilidad." },
  { patron: /\b(inventario|existencias|stock|quiebre(s)? de (stock|inventario))\b/,
    motivo: "El cubo no trae inventario." },
  { patron: /\b(cedula(s)?|subgrupo|dni|identidad|telefono|direccion del cliente)\b/,
    motivo: "Los datos personales no se consultan desde el asistente." },
  { patron: /\b((que|cuales|quienes|lista( de)?|top|principales|mayores|nombre(s)? de( los)?)\s+(\w+\s+)?clientes?|clientes? que (mas|menos|dejaron|perdimos|se perdieron|compraron)|cliente\s+\S+\s+(compro|vendio))/,
    motivo: "El detalle por cliente no se envía al modelo de IA (S10). Puedo responder con totales: clientes con compra, facturas y ticket." },
];

/** Devuelve el motivo si la pregunta está fuera de alcance; null si se puede responder. */
export function fueraDeAlcance(pregunta: string): string | null {
  const t = normalizar(pregunta).replace(/[¿?¡!.,;:()"]/g, " ");
  if (/\bcuant[oa]s clientes\b|clientes con compra/.test(t) && !/\b(que|cuales|quienes) clientes\b/.test(t)) {
    // "¿cuántos clientes compraron?" es un total permitido; solo se revisan los demás temas.
    return REGLAS.slice(0, -1).find((r) => r.patron.test(t))?.motivo ?? null;
  }
  return REGLAS.find((r) => r.patron.test(t))?.motivo ?? null;
}
