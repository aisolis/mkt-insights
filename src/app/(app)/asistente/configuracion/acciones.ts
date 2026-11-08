"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requerirAdmin } from "@/lib/auth/acceso";
import { guardarConfig, guardarTope, probarModelo, type ResultadoPrueba } from "@/lib/asistente/config-servidor";
import { usd } from "@/lib/asistente/dinero";

export type EstadoConfig = { error?: string; ok?: string } | null;

/** Guarda si se usa IA y con qué modelo ("" = el por defecto del servidor). */
export async function guardarModelo(_: EstadoConfig, form: FormData): Promise<EstadoConfig> {
  const admin = await requerirAdmin();
  const usarIa = form.get("usarIa") === "si";
  const modelo = String(form.get("modelo") ?? "").trim() || null;
  const r = await guardarConfig({ usarIa, modelo }, admin.id);
  if (r.error) return { error: r.error };
  revalidatePath("/asistente/configuracion");
  revalidatePath("/asistente");
  return { ok: usarIa ? "Guardado. Las próximas preguntas usan este modelo." : "Guardado. El asistente responde solo con el análisis automático." };
}

export type EstadoPrueba = { error?: string; resultado?: ResultadoPrueba } | null;

const Prueba = z.object({ modelo: z.string().trim().min(3).max(120), pregunta: z.string().trim().min(2).max(500) });

/** Responde una pregunta con el modelo elegido, sin guardar nada. Gasta tokens de OpenRouter. */
export async function probar(_: EstadoPrueba, form: FormData): Promise<EstadoPrueba> {
  const admin = await requerirAdmin();
  const d = Prueba.safeParse({ modelo: form.get("modeloPrueba"), pregunta: form.get("pregunta") });
  if (!d.success) return { error: "Elige un modelo y escribe una pregunta." };
  const r = await probarModelo(d.data.modelo, d.data.pregunta, admin.id);
  // El costo de la prueba cuenta para el gasto del mes que muestra la página.
  revalidatePath("/asistente/configuracion");
  return "error" in r ? { error: r.error } : { resultado: r };
}

/** Tope de gasto mensual en dólares ("" = sin tope). Acepta coma o punto decimal. */
export async function guardarTopeMensual(_: EstadoConfig, form: FormData): Promise<EstadoConfig> {
  const admin = await requerirAdmin();
  const crudo = String(form.get("tope") ?? "").trim().replace(/\s|US\$|\$/gi, "").replace(",", ".");
  const tope = crudo === "" ? null : Number(crudo);
  if (tope !== null && (!Number.isFinite(tope) || tope <= 0)) return { error: "Escribe un monto en dólares mayor que cero, o déjalo vacío para no tener tope." };
  const r = await guardarTope(tope, admin.id);
  if (r.error) return { error: r.error };
  revalidatePath("/asistente/configuracion");
  return { ok: tope === null ? "Guardado: sin tope de gasto." : `Guardado: tope de ${usd(tope)} al mes.` };
}
