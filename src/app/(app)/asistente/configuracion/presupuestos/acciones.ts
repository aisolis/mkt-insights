"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requerirAdmin } from "@/lib/auth/acceso";
import { usd } from "@/lib/asistente/dinero";
import { leerMonto } from "@/lib/asistente/presupuesto";
import { guardarPresupuestoDe, guardarPresupuestoGeneral, resolverSolicitud } from "@/lib/asistente/presupuesto-servidor";

export type EstadoPresupuestos = { error?: string; ok?: string } | null;

const RUTA = "/asistente/configuracion/presupuestos";
const MONTO_INVALIDO = "Escribe un monto en dólares mayor que cero.";

/** Presupuesto mensual general por persona ("" = sin límite por persona). */
export async function guardarGeneral(_: EstadoPresupuestos, form: FormData): Promise<EstadoPresupuestos> {
  const admin = await requerirAdmin();
  const monto = leerMonto(String(form.get("monto") ?? ""));
  if (Number.isNaN(monto)) return { error: `${MONTO_INVALIDO} Déjalo vacío para no limitar por persona.` };
  const r = await guardarPresupuestoGeneral(monto, admin.id);
  if (r.error) return { error: r.error };
  revalidatePath(RUTA);
  return { ok: monto === null ? "Guardado: sin límite por persona." : `Guardado: ${usd(monto)} al mes por persona.` };
}

/** Presupuesto de una persona: `tipo` = general (usa el de todos), propio (con `monto`) o sin_limite. */
export async function guardarDePersona(_: EstadoPresupuestos, form: FormData): Promise<EstadoPresupuestos> {
  const admin = await requerirAdmin();
  const id = z.uuid().safeParse(form.get("usuario"));
  const tipo = z.enum(["general", "propio", "sin_limite"]).safeParse(form.get("tipo"));
  if (!id.success || !tipo.success) return { error: "Datos no válidos." };
  let monto: number | null = null;
  if (tipo.data === "propio") {
    monto = leerMonto(String(form.get("monto") ?? ""));
    if (monto === null || Number.isNaN(monto)) return { error: MONTO_INVALIDO };
  }
  const r = await guardarPresupuestoDe(id.data, monto, tipo.data === "sin_limite", admin.id);
  if (r.error) return { error: r.error };
  revalidatePath(RUTA);
  return { ok: "Guardado. Aplica desde su próxima pregunta." };
}

/** Aprueba (con un monto, que vale solo ese mes) o rechaza una solicitud de ampliación. */
export async function resolver(_: EstadoPresupuestos, form: FormData): Promise<EstadoPresupuestos> {
  const admin = await requerirAdmin();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Solicitud no válida." };
  const aprobar = form.get("decision") === "aprobar";
  const respuesta = String(form.get("respuesta") ?? "");
  let monto: number | null = null;
  if (aprobar) {
    monto = leerMonto(String(form.get("monto") ?? ""));
    if (monto === null || Number.isNaN(monto)) return { error: "Indica el monto que apruebas, en dólares y mayor que cero." };
  }
  const r = await resolverSolicitud(id, aprobar, monto, respuesta, admin.id);
  if (r.error) return { error: r.error };
  revalidatePath(RUTA);
  return { ok: aprobar ? `Aprobada: ${usd(monto!)} más para este mes.` : "Solicitud rechazada." };
}
