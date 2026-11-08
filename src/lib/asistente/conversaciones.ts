import "server-only";
import { z } from "zod";
import { leerParams, periodoComparado, queryString } from "@/lib/dashboard/params";
import { capital } from "@/lib/format";
import type { VersionVigente } from "@/lib/semantic/contracts";
import type { FilaBitacora } from "@/lib/semantic/queries";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { describirFiltros, rango } from "./texto";
import type { Respuesta, Turno } from "./tipos";

/**
 * Conversaciones del asistente (G8, 0010_conversaciones.sql). Las lecturas y los cambios de conversaciones pasan
 * por el cliente con la sesión del usuario: RLS garantiza que cada quien ve, crea y cambia solo las suyas (una
 * ajena se comporta como inexistente). La única escritura con service_role es registrarTurno.
 * Los turnos son las filas de la bitácora (ventas.consulta_asistente) con su conversacion_id.
 */

export type ConversacionResumen = {
  id: string; titulo: string; contexto: string; creada_en: string; actualizada_en: string; preguntas: number;
};
/** Un turno para volver a pintar el chat: la respuesta completa guardada o, si falló, un error genérico. */
export type TurnoGuardado = { id: number; creado_en: string; pregunta: string; respuesta?: Respuesta; error?: string };

/** Máximo de conversaciones en el panel. */
export const MAX_LISTA = 30;
/** Turnos respondidos (pregunta + respuesta) que se cargan como historial del modelo. */
/** Turnos (pregunta + respuesta) que ve el modelo: 3 turnos = los últimos 6 mensajes. */
export const TURNOS_HISTORIAL = 3;
export const MAX_TITULO = 120;

export const IdConversacion = z.uuid();
export const Titulo = z.string().trim().min(1).max(MAX_TITULO);

const COLUMNAS = "id, titulo, contexto, creada_en, actualizada_en";
type Fila = Omit<ConversacionResumen, "preguntas">;
type FilaConConteo = Fila & { consulta_asistente: { count: number }[] };

const tabla = async (nombre: "conversacion" | "consulta_asistente") => (await createClient()).schema("ventas").from(nombre);

function fallo(accion: string, error: { message: string }): never {
  throw new Error(`conversaciones (${accion}): ${error.message}`);
}

/** Título a partir de la primera pregunta: hasta ~80 caracteres, cortado en una palabra. */
export function tituloDe(pregunta: string, max = 80): string {
  const limpio = pregunta.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.¿?¡!-]+$/, "")}…`;
}

export async function crearConversacion(usuarioId: string, titulo: string, contexto: string): Promise<ConversacionResumen> {
  const { data, error } = await (await tabla("conversacion"))
    .insert({ usuario_id: usuarioId, titulo: tituloDe(titulo, MAX_TITULO), contexto })
    .select(COLUMNAS).single<Fila>();
  if (error) fallo("crear", error);
  return { ...data, preguntas: 0 };
}

/** Las últimas conversaciones sin archivar, con su número de preguntas. */
export async function listarConversaciones(limite = MAX_LISTA): Promise<ConversacionResumen[]> {
  const { data, error } = await (await tabla("conversacion"))
    .select(`${COLUMNAS}, consulta_asistente(count)`)
    .is("archivada_en", null)
    .order("actualizada_en", { ascending: false })
    .limit(limite)
    .overrideTypes<FilaConConteo[], { merge: false }>();
  if (error) fallo("listar", error);
  return data.map(({ consulta_asistente, ...c }) => ({ ...c, preguntas: consulta_asistente[0]?.count ?? 0 }));
}

/** Una conversación del usuario sin archivar; null si no existe, es de otro o está archivada. */
export async function obtenerConversacion(id: string): Promise<ConversacionResumen | null> {
  if (!IdConversacion.safeParse(id).success) return null;
  const { data, error } = await (await tabla("conversacion"))
    .select(`${COLUMNAS}, consulta_asistente(count)`)
    .eq("id", id).is("archivada_en", null)
    .maybeSingle<FilaConConteo>();
  if (error) fallo("obtener", error);
  if (!data) return null;
  const { consulta_asistente, ...c } = data;
  return { ...c, preguntas: consulta_asistente[0]?.count ?? 0 };
}

type FilaTurno = { id: number; creado_en: string; pregunta: string; estado: FilaBitacora["estado"]; texto: string | null; respuesta: Respuesta | null };

/** Todos los turnos de una conversación, en orden, con la respuesta guardada para volver a pintarla. */
export async function cargarTurnos(conversacionId: string): Promise<TurnoGuardado[]> {
  const { data, error } = await (await tabla("consulta_asistente"))
    .select("id, creado_en, pregunta, estado, texto, respuesta")
    .eq("conversacion_id", conversacionId)
    .order("creado_en", { ascending: true }).order("id", { ascending: true })
    .overrideTypes<FilaTurno[], { merge: false }>();
  if (error) fallo("turnos", error);
  // El detalle técnico del error queda en la bitácora; al usuario se le muestra un mensaje genérico.
  return data.map((t) => (t.estado === "error" || !t.respuesta
    ? { id: t.id, creado_en: t.creado_en, pregunta: t.pregunta, error: "No se pudo responder la pregunta. Quedó registrada para revisión." }
    : { id: t.id, creado_en: t.creado_en, pregunta: t.pregunta, respuesta: t.respuesta }));
}

/**
 * Historial acotado para el modelo: los últimos `n` turnos respondidos (sin errores), como pregunta + texto de
 * la respuesta, y la última respuesta OK (de ahí sale la memoria estructurada).
 */
export async function historialReciente(conversacionId: string, n = TURNOS_HISTORIAL): Promise<{ historial: Turno[]; ultimaOk: Respuesta | null }> {
  const { data, error } = await (await tabla("consulta_asistente"))
    .select("id, creado_en, pregunta, estado, texto, respuesta")
    .eq("conversacion_id", conversacionId).neq("estado", "error")
    .order("creado_en", { ascending: false }).order("id", { ascending: false })
    .limit(n)
    .overrideTypes<FilaTurno[], { merge: false }>();
  if (error) fallo("historial", error);
  const turnos = [...data].reverse();
  return {
    historial: turnos.flatMap((t): Turno[] => [
      { rol: "usuario", texto: t.pregunta },
      ...(t.texto ? [{ rol: "asistente" as const, texto: t.texto }] : []),
    ]),
    ultimaOk: data.find((t) => t.estado === "ok" && t.respuesta)?.respuesta ?? null,
  };
}

/** Registra la pregunta en la bitácora dentro de su conversación. Si falla, no rompe la respuesta. */
/**
 * Registra un turno en la bitácora. Lo escribe el servidor con service_role (0012_bitacora_servidor.sql): el
 * usuario no puede insertar filas, así que el historial y la memoria del modelo salen solo de respuestas reales.
 * Quien llama ya comprobó con la sesión del usuario (RLS) que la conversación es suya.
 * `reglas`: ids de las reglas del asistente activas al responder (G8), para auditar con qué reglas se respondió.
 */
export async function registrarTurno(fila: FilaBitacora & { conversacion_id: string; reglas: string[] }) {
  try {
    const { error } = await createServiceClient().schema("ventas").from("consulta_asistente").insert(fila);
    if (error) console.error("bitácora del asistente:", error.message);
  } catch (e) {
    console.error("bitácora del asistente:", e);
  }
}

export async function contarPreguntas(conversacionId: string): Promise<number> {
  const { count, error } = await (await tabla("consulta_asistente"))
    .select("id", { count: "exact", head: true }).eq("conversacion_id", conversacionId);
  if (error) fallo("contar", error);
  return count ?? 0;
}

/** Marca actividad: la conversación sube al principio de la lista. */
export async function tocarConversacion(id: string): Promise<ConversacionResumen | null> {
  return actualizar(id, { actualizada_en: new Date().toISOString() }, "tocar");
}

export async function renombrarConversacion(id: string, titulo: string): Promise<ConversacionResumen | null> {
  return actualizar(id, { titulo: Titulo.parse(titulo) }, "renombrar");
}

/** Archivar es el "borrar" del usuario: deja de verse, pero los turnos siguen en la bitácora. */
export async function archivarConversacion(id: string): Promise<boolean> {
  return (await actualizar(id, { archivada_en: new Date().toISOString() }, "archivar")) !== null;
}

/** Update que devuelve null si la conversación no es visible para el usuario (ajena, inexistente o archivada). */
async function actualizar(id: string, cambios: Record<string, string>, accion: string): Promise<ConversacionResumen | null> {
  if (!IdConversacion.safeParse(id).success) return null;
  const { data, error } = await (await tabla("conversacion"))
    .update(cambios).eq("id", id).is("archivada_en", null)
    .select(`${COLUMNAS}, consulta_asistente(count)`)
    .maybeSingle<FilaConConteo>();
  if (error) fallo(accion, error);
  if (!data) return null;
  const { consulta_asistente, ...c } = data;
  return { ...c, preguntas: consulta_asistente[0]?.count ?? 0 };
}

/** Query string normalizada y su descripción en palabras ("Septiembre 2026 vs. agosto 2026 · Todos los canales"). */
export function contextoEnPalabras(contexto: string, version: VersionVigente) {
  const estado = leerParams(Object.fromEntries(new URLSearchParams(contexto)), version.metadatos.periodos);
  const cmp = periodoComparado(estado.periodo, estado.comparar);
  return { estado, contexto: queryString(estado), texto: `${capital(rango(estado.periodo, cmp))} · ${describirFiltros(estado.filtros, version.metadatos)}` };
}
