"use server";
import "server-only";
import { z } from "zod";
import { requerirAcceso } from "@/lib/auth/acceso";
import { versionVigente } from "@/lib/semantic/queries";
import { createClient } from "@/lib/supabase/server";
import { consultaDeVista, MAX_NOMBRE_VISTA, type VistaGuardada } from "./vistas-consulta";

/**
 * Vistas guardadas del dashboard (G9, 0018_vistas.sql). Funciones de servidor que llama la barra de filtros.
 * Todo pasa por el cliente con la sesión del usuario: RLS deja leer las propias y las compartidas, y cambiar o
 * borrar solo las propias (una ajena se comporta como inexistente). El nombre del autor sale del campo calculado
 * ventas.autor_vista, porque public.perfil solo deja leer el propio.
 */

type Fallo = { ok: false; error: string };
export type ResultadoVistas = { ok: true; vistas: VistaGuardada[] } | Fallo;
export type ResultadoVista = { ok: true; vista: VistaGuardada } | Fallo;

const Id = z.uuid();
const Nombre = z.string().trim().min(1, "Escribe un nombre.").max(MAX_NOMBRE_VISTA, `Máximo ${MAX_NOMBRE_VISTA} caracteres.`);
const Nueva = z.object({ nombre: Nombre, consulta: z.string().max(4000), compartida: z.boolean(), fijarPeriodo: z.boolean() });
const Cambios = z.object({ nombre: Nombre.optional(), compartida: z.boolean().optional() });

const COLUMNAS = "id, usuario_id, nombre, consulta, compartida, actualizada_en, autor:autor_vista";
type Fila = Omit<VistaGuardada, "propia"> & { usuario_id: string };

const tabla = async () => (await createClient()).schema("ventas").from("vista_guardada");
const aVista = ({ usuario_id, ...f }: Fila, yo: string): VistaGuardada => ({ ...f, propia: usuario_id === yo });

const fallo = (error: string): Fallo => ({ ok: false, error });

function mensaje(accion: string, error: { code?: string; message: string }): Fallo {
  if (error.code === "23505") return fallo("Ya tienes una vista con ese nombre.");
  console.error(`vistas (${accion}):`, error.message);
  return fallo("No se pudo guardar el cambio. Intenta de nuevo.");
}

/** Las propias primero (por nombre) y después las compartidas por el equipo. */
export async function listarVistas(): Promise<ResultadoVistas> {
  const yo = await requerirAcceso();
  const { data, error } = await (await tabla()).select(COLUMNAS).order("nombre").limit(200).overrideTypes<Fila[], { merge: false }>();
  if (error) {
    console.error("vistas (listar):", error.message);
    return fallo("No se pudieron cargar las vistas.");
  }
  const vistas = data.map((f) => aVista(f, yo.id));
  return { ok: true, vistas: [...vistas.filter((v) => v.propia), ...vistas.filter((v) => !v.propia)] };
}

/**
 * Guarda los filtros en pantalla como vista nueva. La consulta se normaliza con los periodos de la versión
 * vigente; `fijarPeriodo` false la guarda sin periodo (siempre el último mes).
 */
export async function guardarVista(entrada: { nombre: string; consulta: string; compartida: boolean; fijarPeriodo: boolean }): Promise<ResultadoVista> {
  const yo = await requerirAcceso();
  const e = Nueva.safeParse(entrada);
  if (!e.success) return fallo(e.error.issues[0]?.message ?? "Datos no válidos.");
  const periodos = (await versionVigente())?.metadatos.periodos ?? [];
  const consulta = consultaDeVista(e.data.consulta, periodos, e.data.fijarPeriodo);
  const { data, error } = await (await tabla())
    .insert({ usuario_id: yo.id, nombre: e.data.nombre, consulta, compartida: e.data.compartida })
    .select(COLUMNAS).single<Fila>();
  if (error) return mensaje("guardar", error);
  return { ok: true, vista: aVista(data, yo.id) };
}

/** Renombrar o compartir / dejar de compartir. Solo el dueño (RLS); una ajena da "no encontrada". */
export async function editarVista(id: string, cambios: { nombre?: string; compartida?: boolean }): Promise<ResultadoVista> {
  const yo = await requerirAcceso();
  const c = Cambios.safeParse(cambios);
  if (!Id.safeParse(id).success) return fallo("Vista no encontrada.");
  if (!c.success) return fallo(c.error.issues[0]?.message ?? "Datos no válidos.");
  if (c.data.nombre === undefined && c.data.compartida === undefined) return fallo("Nada que cambiar.");
  const { data, error } = await (await tabla()).update(c.data).eq("id", id).eq("usuario_id", yo.id).select(COLUMNAS).maybeSingle<Fila>();
  if (error) return mensaje("editar", error);
  if (!data) return fallo("Vista no encontrada o no es tuya.");
  return { ok: true, vista: aVista(data, yo.id) };
}

export async function borrarVista(id: string): Promise<{ ok: true } | Fallo> {
  const yo = await requerirAcceso();
  if (!Id.safeParse(id).success) return fallo("Vista no encontrada.");
  const { data, error } = await (await tabla()).delete().eq("id", id).eq("usuario_id", yo.id).select("id");
  if (error) return mensaje("borrar", error);
  if (!data.length) return fallo("Vista no encontrada o no es tuya.");
  return { ok: true };
}
