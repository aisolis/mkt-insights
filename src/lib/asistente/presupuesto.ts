/**
 * Presupuesto de IA por persona (0032): cuánto puede gastar cada quien al mes y qué pasa cuando se acaba.
 * Puro (sin base ni servidor): lo usan el servidor, el chat, la pantalla del admin y las pruebas.
 *
 * Reglas:
 * - El límite de una persona es su presupuesto del mes (el propio o el general) más las ampliaciones aprobadas ese mes.
 * - Agotado = lo gastado ya alcanzó el límite. La pregunta en curso no se corta: se revisa antes de cada pregunta.
 * - Con el presupuesto agotado responde el análisis automático por reglas (mismas cifras), igual que con el tope
 *   global, y la persona puede pedir una ampliación.
 * - El tope global de la app sigue mandando: se revisa primero.
 */
import { z } from "zod";
import { usd } from "./dinero";
import type { Decision } from "./modelo";

/** Una fila de ventas.presupuestos_ia(). `limite_usd` nulo = sin límite. */
export const FilaPresupuesto = z.object({
  usuario_id: z.string(), nombre: z.string(), activo: z.boolean(), mes: z.string(),
  origen: z.enum(["propio", "general", "sin_limite"]),
  base_usd: z.coerce.number().nullable(), ampliaciones_usd: z.coerce.number(), limite_usd: z.coerce.number().nullable(),
  gasto_usd: z.coerce.number(), preguntas: z.coerce.number(), pendiente: z.boolean(),
});
export type FilaPresupuesto = z.infer<typeof FilaPresupuesto>;

/** Lo que el chat necesita saber del presupuesto de quien pregunta. Sin límite: `limiteUsd` nulo y nunca agotado. */
export type EstadoPresupuesto = {
  limiteUsd: number | null; gastoUsd: number; restanteUsd: number | null; agotado: boolean;
  /** Hay una solicitud de ampliación esperando respuesta este mes. */
  pendiente: boolean;
};

export function estadoPresupuesto(f: Pick<FilaPresupuesto, "limite_usd" | "gasto_usd" | "pendiente">): EstadoPresupuesto {
  const limite = f.limite_usd;
  return {
    limiteUsd: limite, gastoUsd: f.gasto_usd, restanteUsd: limite === null ? null : Math.max(0, limite - f.gasto_usd),
    agotado: limite !== null && f.gasto_usd >= limite, pendiente: f.pendiente,
  };
}

export const SIN_LIMITE: EstadoPresupuesto = { limiteUsd: null, gastoUsd: 0, restanteUsd: null, agotado: false, pendiente: false };

export const avisoPresupuesto = (e: EstadoPresupuesto) =>
  `Se acabó tu presupuesto de IA de este mes (${usd(e.limiteUsd ?? 0)}): hasta el próximo mes, o hasta que te aprueben una ampliación, responde el análisis automático por reglas. Las cifras son las mismas.`;

/**
 * Aplica el presupuesto de la persona a la decisión global (tope de la app, modelo permitido). Si esa decisión ya
 * dejó la pregunta sin modelo, no cambia; si había modelo y la persona agotó su presupuesto, pasa a automático.
 */
export function conPresupuesto(decision: Decision, e: EstadoPresupuesto): Decision {
  if (!decision.modelo || !e.agotado) return decision;
  return { modelo: null, motivo: "presupuesto_usuario", aviso: avisoPresupuesto(e) };
}

export const MAX_MOTIVO = 500;

/** Monto en dólares escrito por una persona: acepta coma o punto y el signo. null = vacío; NaN = no es un monto. */
export function leerMonto(crudo: string): number | null {
  const limpio = crudo.trim().replace(/\s|US\$|\$/gi, "").replace(",", ".");
  if (limpio === "") return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : Number.NaN;
}

export type Solicitud = {
  id: number; usuarioId: string; nombre: string; mes: string; motivo: string | null; estado: "pendiente" | "aprobada" | "rechazada";
  montoUsd: number | null; respuesta: string | null; solicitadaEn: string; resueltaEn: string | null; resueltaPor: string | null;
};
