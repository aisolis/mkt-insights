"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requerirGestorCargas } from "@/lib/auth/acceso";
import { conciliar, descartar, MetaCarga, prepararCarga, publicar, retirar, type SubidaCarga } from "@/lib/cargas/servidor";

export type Estado = { error?: string; ok?: string } | null;

/** Paso 1: registra la carga y devuelve la URL firmada; el navegador sube el Excel directo a Storage. */
export async function prepararCargaAccion(meta: unknown): Promise<SubidaCarga> {
  const usuario = await requerirGestorCargas();
  const datos = MetaCarga.safeParse(meta);
  if (!datos.success) return { error: datos.error.issues[0].message };
  return prepararCarga(datos.data, usuario.id);
}

const listo = (r: { error?: string }, ok: string): Estado => {
  if (r.error) return { error: r.error };
  revalidatePath("/cargas");
  revalidatePath("/", "layout"); // la cabecera y el dashboard muestran la versión vigente
  return { ok };
};

export async function publicarCarga(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Carga no válida." };
  const notas = String(form.get("notas") ?? "").trim().slice(0, 500) || null;
  const r = await publicar(id.data, notas, form.get("mesCompleto") === "on", form.get("revisado") === "on", usuario.id);
  return listo(r, r.version ? `Publicada la versión v${r.version}.` : "");
}

export async function retirarVersion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const version = z.coerce.number().int().positive().safeParse(form.get("version"));
  const motivo = String(form.get("motivo") ?? "").trim();
  if (!version.success) return { error: "Versión no válida." };
  if (motivo.length < 5) return { error: "Escribe el motivo del retiro." };
  return listo(await retirar(version.data, motivo, usuario.id), `Se retiró la v${version.data}.`);
}

export async function conciliarVersion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const version = z.coerce.number().int().positive().safeParse(form.get("version"));
  const nota = String(form.get("nota") ?? "").trim();
  if (!version.success) return { error: "Versión no válida." };
  if (nota.length < 10) return { error: "Indica contra qué reporte de BI se comparó (periodo, cifras revisadas)." };
  return listo(await conciliar(version.data, nota, usuario.id), `La v${version.data} quedó conciliada con BI.`);
}

export async function descartarCarga(_: Estado, form: FormData): Promise<Estado> {
  await requerirGestorCargas();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Carga no válida." };
  return listo(await descartar(id.data), "Carga descartada.");
}
