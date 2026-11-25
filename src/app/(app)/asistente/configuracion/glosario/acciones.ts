"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requerirAdmin } from "@/lib/auth/acceso";
import { partirSinonimos, type EntradaTermino } from "@/lib/asistente/glosario";
import { leerGlosario, MAX_BYTES_GLOSARIO } from "@/lib/asistente/glosario-archivo";
import { activarTermino, crearTermino, editarTermino, eliminarTermino, importarGlosario } from "@/lib/asistente/glosario-servidor";

/** `valores`: lo que escribió la persona, para no perderlo si hubo un error (React reinicia el formulario). */
export type EstadoTermino = { error?: string; ok?: string; valores?: { termino: string; sinonimos: string; definicion: string } } | null;

const RUTA = "/asistente/configuracion/glosario";

/** Crea (sin id) o edita (con id) un término. Los sinónimos llegan separados por comas o uno por línea. */
export async function guardarTermino(_: EstadoTermino, form: FormData): Promise<EstadoTermino> {
  const admin = await requerirAdmin();
  const valores = { termino: String(form.get("termino") ?? ""), sinonimos: String(form.get("sinonimos") ?? ""), definicion: String(form.get("definicion") ?? "") };
  const entrada: EntradaTermino = { termino: valores.termino, definicion: valores.definicion, sinonimos: partirSinonimos(valores.sinonimos) };
  const idCrudo = form.get("id");
  const id = idCrudo ? z.uuid().safeParse(idCrudo) : null;
  if (id && !id.success) return { error: "Término no válido.", valores };

  const r = id ? await editarTermino(id.data, entrada, admin.id) : await crearTermino(entrada, admin.id);
  if (r.error) return { error: r.error, valores };
  revalidatePath(RUTA);
  return { ok: id ? "Cambios guardados." : "Término agregado. Se usa desde la próxima pregunta." };
}

export async function cambiarActivo(_: EstadoTermino, form: FormData): Promise<EstadoTermino> {
  const admin = await requerirAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Término no válido." };
  const r = await activarTermino(id.data, form.get("activo") === "si", admin.id);
  if (r.error) return { error: r.error };
  revalidatePath(RUTA);
  return { ok: "Guardado." };
}

export async function borrarTermino(_: EstadoTermino, form: FormData): Promise<EstadoTermino> {
  await requerirAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Término no válido." };
  const r = await eliminarTermino(id.data);
  if (r.error) return { error: r.error };
  revalidatePath(RUTA);
  return { ok: "Término eliminado." };
}

export type EstadoCarga = { error?: string; ok?: string; errores?: string[] } | null;

/**
 * Carga un glosario desde Excel o CSV. Si alguna fila no es válida no se guarda nada: se devuelven las filas con
 * problema para corregir el archivo y volver a subirlo (así el glosario nunca queda cargado a medias).
 */
export async function cargarGlosario(_: EstadoCarga, form: FormData): Promise<EstadoCarga> {
  const admin = await requerirAdmin();
  const archivo = form.get("archivo");
  if (!(archivo instanceof File) || !archivo.size) return { error: "Elige un archivo Excel (.xlsx) o CSV." };
  if (archivo.size > MAX_BYTES_GLOSARIO) return { error: "El archivo pasa de 700 KB. Revisa que sea el glosario." };

  const leido = await leerGlosario(new Uint8Array(await archivo.arrayBuffer()), archivo.name);
  if (leido.error !== undefined) return { error: leido.error };
  if (leido.errores.length) {
    return {
      error: `${leido.errores.length === 1 ? "Una fila tiene" : `${leido.errores.length} filas tienen`} un problema. No se cargó nada: corrige el archivo y súbelo de nuevo.`,
      errores: leido.errores.slice(0, 15),
    };
  }
  const r = await importarGlosario(leido.filas, admin.id);
  if ("error" in r) return { error: r.error };
  revalidatePath(RUTA);
  const partes = [r.nuevos && `${r.nuevos} ${r.nuevos === 1 ? "término nuevo" : "términos nuevos"}`, r.actualizados && `${r.actualizados} ${r.actualizados === 1 ? "actualizado" : "actualizados"}`].filter(Boolean);
  return { ok: `Glosario cargado: ${partes.join(" y ") || "sin cambios"}.` };
}
