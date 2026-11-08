"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requerirAdmin } from "@/lib/auth/acceso";
import { activarRegla, crearRegla, editarRegla, eliminarRegla, type EntradaRegla } from "@/lib/asistente/reglas-servidor";

/** `valores`: lo que escribió la persona, para no perderlo si hubo un error (React reinicia el formulario). */
export type EstadoRegla = { error?: string; ok?: string; valores?: { texto: string; terminos: string } } | null;

const RUTA = "/asistente/reglas";

/** Crea (sin id) o edita (con id) una regla. Los términos llegan uno por línea o separados por comas. */
export async function guardarRegla(_: EstadoRegla, form: FormData): Promise<EstadoRegla> {
  const admin = await requerirAdmin();
  const texto = String(form.get("texto") ?? ""), terminos = String(form.get("terminos") ?? "");
  const entrada: EntradaRegla = { tipo: form.get("tipo") as EntradaRegla["tipo"], texto, terminos: terminos.split(/[\n,;]/) };
  const idCrudo = form.get("id");
  const id = idCrudo ? z.uuid().safeParse(idCrudo) : null;
  if (id && !id.success) return { error: "Regla no válida.", valores: { texto, terminos } };

  const r = id ? await editarRegla(id.data, entrada, admin.id) : await crearRegla(entrada, admin.id);
  if (r.error) return { error: r.error, valores: { texto, terminos } };
  revalidatePath(RUTA);
  return { ok: id ? "Cambios guardados." : "Regla agregada. Se aplica desde la próxima pregunta." };
}

export async function cambiarActiva(_: EstadoRegla, form: FormData): Promise<EstadoRegla> {
  const admin = await requerirAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Regla no válida." };
  const r = await activarRegla(id.data, form.get("activa") === "si", admin.id);
  if (r.error) return { error: r.error };
  revalidatePath(RUTA);
  return { ok: "Guardado." };
}

export async function borrarRegla(_: EstadoRegla, form: FormData): Promise<EstadoRegla> {
  const admin = await requerirAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Regla no válida." };
  const r = await eliminarRegla(id.data, admin.id);
  if (r.error) return { error: r.error };
  revalidatePath(RUTA);
  return { ok: "Regla eliminada." };
}
