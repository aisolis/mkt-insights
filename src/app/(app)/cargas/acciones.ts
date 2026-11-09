"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requerirGestorCargas } from "@/lib/auth/acceso";
import { rolGestion } from "@/lib/auth/reglas";
import { subirControl } from "@/lib/cargas/control-servidor";
import { anularAprobacion, aprobar, descartar, enviarResumenPublicado, MetaCarga, prepararCarga, publicar, retirar, type SubidaCarga } from "@/lib/cargas/servidor";

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

export async function aprobarCarga(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Carga no válida." };
  const motivo = String(form.get("motivo") ?? "").trim().slice(0, 500) || null;
  return listo(await aprobar(id.data, form.get("mesCompleto") === "on", motivo, usuario.id, rolGestion(usuario, "aprobar")), "Carga aprobada. Ya se puede publicar.");
}

export async function anularAprobacionCarga(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Carga no válida." };
  const motivo = String(form.get("motivo") ?? "").trim();
  if (motivo.length < 5) return { error: "Escribe por qué se quita la aprobación." };
  return listo(await anularAprobacion(id.data, motivo.slice(0, 300), usuario.id), "Se quitó la aprobación.");
}

export async function publicarCarga(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Carga no válida." };
  const notas = String(form.get("notas") ?? "").trim().slice(0, 500) || null;
  const r = await publicar(id.data, notas, usuario.id, rolGestion(usuario, "publicar"));
  if (r.error || !r.version) return { error: r.error ?? "No se pudo publicar." };
  revalidatePath("/cargas");
  revalidatePath("/", "layout"); // la cabecera y el dashboard muestran la versión vigente
  // Opcional: el resumen del mes al equipo. Solo sale en producción (src/lib/correo.ts); nunca frena la publicación.
  let correo = "";
  if (form.get("correo") === "on") {
    const h = await headers();
    const origen = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    correo = `&correo=${await enviarResumenPublicado(r.version, origen)}`;
  }
  // La tarjeta de la carga desaparece al publicarse: el aviso (con el enlace al resumen) lo muestra la página.
  redirect(`/cargas?publicada=${r.version}${correo}`);
}

export async function retirarVersion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const version = z.coerce.number().int().positive().safeParse(form.get("version"));
  const motivo = String(form.get("motivo") ?? "").trim();
  if (!version.success) return { error: "Versión no válida." };
  if (motivo.length < 5) return { error: "Escribe el motivo del retiro." };
  return listo(await retirar(version.data, motivo, usuario.id), `Se retiró la v${version.data}.`);
}

const DatosControl = z.object({
  custodio: z.string().trim().min(3, "Indica quién en BI generó el reporte.").max(120),
  fecha_corte: z.iso.date("Indica la fecha de corte del reporte de BI."),
  nota: z.string().trim().max(300).transform((s) => s || null),
  decimales_kg: z.coerce.number().int().min(0).max(4),
});

/** Sube el reporte de BI de una carga (lista para publicar o la de la versión vigente) y lo compara (V1-06). */
export async function subirControlAccion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const id = z.uuid().safeParse(form.get("carga"));
  if (!id.success) return { error: "Carga no válida." };
  const archivo = form.get("archivo");
  if (!(archivo instanceof File) || !archivo.size) return { error: "Elige el reporte de BI (.xlsx o .csv)." };
  const datos = DatosControl.safeParse({
    custodio: form.get("custodio") ?? "", fecha_corte: form.get("fecha_corte") ?? "", nota: form.get("nota") ?? "", decimales_kg: form.get("decimales_kg") ?? 2,
  });
  if (!datos.success) return { error: datos.error.issues[0].message };
  const r = await subirControl(id.data, archivo, datos.data, usuario.id);
  if (r.error) return { error: r.error };
  revalidatePath("/cargas");
  revalidatePath("/", "layout");
  return { ok: r.ok };
}

export async function descartarCarga(_: Estado, form: FormData): Promise<Estado> {
  await requerirGestorCargas();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Carga no válida." };
  return listo(await descartar(id.data), "Carga descartada.");
}
