"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requerirAdmin } from "@/lib/auth/acceso";
import { guardarConfig, probarModelo, type ResultadoPrueba } from "@/lib/asistente/config-servidor";

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
  await requerirAdmin();
  const d = Prueba.safeParse({ modelo: form.get("modeloPrueba"), pregunta: form.get("pregunta") });
  if (!d.success) return { error: "Elige un modelo y escribe una pregunta." };
  const r = await probarModelo(d.data.modelo, d.data.pregunta);
  return "error" in r ? { error: r.error } : { resultado: r };
}
