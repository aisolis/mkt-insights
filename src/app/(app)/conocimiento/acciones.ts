"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requerirAdmin } from "@/lib/auth/acceso";
import { cambiarVigencia, MetaDocumento, prepararSubida, procesar, type Subida } from "@/lib/conocimiento/servidor";

/** Paso 1: registra el documento y devuelve la URL firmada; el navegador sube el PDF directo a Storage. */
export async function prepararDocumento(meta: unknown): Promise<Subida> {
  const admin = await requerirAdmin();
  const datos = MetaDocumento.safeParse(meta);
  if (!datos.success) return { error: datos.error.issues[0].message };
  return prepararSubida(datos.data, admin.id);
}

/** Paso 2: con el PDF ya en Storage, extrae, fragmenta e indexa. También sirve para reintentar un error. */
export async function procesarDocumentoSubido(id: string) {
  await requerirAdmin();
  if (!z.uuid().safeParse(id).success) return { estado: "error" as const, error: "Documento no válido." };
  const r = await procesar(id);
  revalidatePath("/conocimiento");
  return r;
}

export type EstadoVigencia = { error?: string } | null;

export async function cambiarVigenciaDocumento(_: EstadoVigencia, form: FormData): Promise<EstadoVigencia> {
  await requerirAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Documento no válido." };
  const vigente = form.get("vigente") === "si";
  const motivo = String(form.get("motivo") ?? "").trim().slice(0, 300);
  if (!vigente && motivo.length < 5) return { error: "Escribe el motivo del retiro." };
  const r = await cambiarVigencia(id.data, vigente, vigente ? null : motivo);
  if (!r.error) revalidatePath("/conocimiento");
  return r;
}
