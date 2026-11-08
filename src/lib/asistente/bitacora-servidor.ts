import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import type { FilaBitacora } from "@/lib/semantic/queries";
import type { ReglaAsistente, Respuesta } from "./tipos";

/**
 * Bitácora del asistente para admin (G8): qué se preguntó, cómo se respondió, con qué reglas y cuánto tardó.
 * Lee con service_role (cada usuario solo ve sus filas por RLS); quien llama ya verificó requerirAdmin().
 * Nunca hay datos de clientes: las respuestas solo llevan agregados (S10).
 */

export type Estado = FilaBitacora["estado"];
export const ESTADOS = ["ok", "fuera_de_alcance", "sin_datos", "error"] as const satisfies readonly Estado[];
export const DIAS = [7, 30, 90] as const;

export const FiltroBitacora = z.object({
  estado: z.enum(ESTADOS).optional().catch(undefined),
  dias: z.enum(["7", "30", "90"]).catch("30").transform(Number),
  usuario: z.uuid().optional().catch(undefined),
});
export type FiltroBitacora = z.infer<typeof FiltroBitacora>;

export type FilaLista = {
  id: number; creado_en: string; usuario: string; usuario_id: string | null; conversacion_id: string | null; version: number | null;
  pregunta: string; estado: Estado; modo: "modelo" | "determinista" | null; modelo: string | null; duracion_ms: number | null;
  reglas: number; respaldo: boolean;
};

export type Resumen = {
  preguntas: number; personas: number; fueraDeAlcance: number; errores: number; sinDatos: number; respaldo: number; conModelo: number;
  medianaSeg: number | null;
};

type FilaBD = {
  id: number; creado_en: string; usuario_id: string | null; conversacion_id: string | null; version: number | null; pregunta: string;
  estado: Estado; modo: "modelo" | "determinista" | null; modelo: string | null; duracion_ms: number | null; reglas: string[] | null;
  advertencias: string[] | null;
};

const MAX_FILAS = 2000;
const svc = () => createServiceClient().schema("ventas");

/** El texto del modelo se descartó por cifras no verificadas o el modelo falló: se respondió con la redacción automática. */
const esRespaldo = (advertencias: string[] | null) => (advertencias ?? []).some((a) => /modelo/i.test(a));

async function nombres(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await createServiceClient().from("perfil").select("user_id, nombre").in("user_id", ids);
  if (error) throw new Error(`bitácora (perfiles): ${error.message}`);
  return new Map((data ?? []).map((p) => [p.user_id as string, p.nombre as string]));
}

/** Filas del periodo con los filtros, más recientes primero, y el resumen calculado sobre las mismas filas. */
export async function leerBitacora(f: FiltroBitacora): Promise<{ filas: FilaLista[]; resumen: Resumen; truncada: boolean }> {
  const desde = new Date(Date.now() - f.dias * 86_400_000).toISOString();
  let q = svc().from("consulta_asistente")
    .select("id, creado_en, usuario_id, conversacion_id, version, pregunta, estado, modo, modelo, duracion_ms, reglas, advertencias:respuesta->evidencia->advertencias")
    .gte("creado_en", desde).order("creado_en", { ascending: false }).limit(MAX_FILAS);
  if (f.estado) q = q.eq("estado", f.estado);
  if (f.usuario) q = q.eq("usuario_id", f.usuario);
  const { data, error } = await q.returns<FilaBD[]>();
  if (error) throw new Error(`bitácora: ${error.message}`);
  const filasBD = data ?? [];
  const mapa = await nombres([...new Set(filasBD.map((r) => r.usuario_id).filter((x): x is string => !!x))]);
  const filas = filasBD.map((r): FilaLista => ({
    id: r.id, creado_en: r.creado_en, usuario_id: r.usuario_id, usuario: (r.usuario_id && mapa.get(r.usuario_id)) || "—",
    conversacion_id: r.conversacion_id, version: r.version, pregunta: r.pregunta, estado: r.estado, modo: r.modo, modelo: r.modelo,
    duracion_ms: r.duracion_ms, reglas: r.reglas?.length ?? 0, respaldo: r.modo === "modelo" && esRespaldo(r.advertencias),
  }));
  const tiempos = filas.map((x) => x.duracion_ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const resumen: Resumen = {
    preguntas: filas.length,
    personas: new Set(filas.map((x) => x.usuario_id).filter(Boolean)).size,
    fueraDeAlcance: filas.filter((x) => x.estado === "fuera_de_alcance").length,
    errores: filas.filter((x) => x.estado === "error").length,
    sinDatos: filas.filter((x) => x.estado === "sin_datos").length,
    conModelo: filas.filter((x) => x.modo === "modelo").length,
    respaldo: filas.filter((x) => x.respaldo).length,
    medianaSeg: tiempos.length ? tiempos[Math.floor(tiempos.length / 2)] / 1000 : null,
  };
  return { filas, resumen, truncada: filasBD.length === MAX_FILAS };
}

/** Quienes preguntaron alguna vez, para el filtro por persona. */
export async function personasConPreguntas(): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await createServiceClient().from("perfil").select("user_id, nombre").order("nombre");
  if (error) throw new Error(`bitácora (perfiles): ${error.message}`);
  return (data ?? []).map((p) => ({ id: p.user_id as string, nombre: p.nombre as string }));
}

export type ReglaAplicada = { id: string; tipo: ReglaAsistente["tipo"] | null; texto: string | null; vigente: boolean };

export type Detalle = {
  id: number; creado_en: string; usuario: string; conversacion: string | null; version: number | null; contexto: string; pregunta: string;
  estado: Estado; modo: "modelo" | "determinista" | null; modelo: string | null; duracion_ms: number | null; texto: string | null;
  respuesta: Respuesta | null; error: string | null; reglas: ReglaAplicada[];
};

/**
 * Una pregunta con todo lo que se registró. Las reglas se muestran como estaban al responder: el texto sale del
 * último cambio anterior a la respuesta en la bitácora de reglas (si se editaron o borraron después, igual se ve).
 */
export async function detalleBitacora(id: number): Promise<Detalle | null> {
  const { data: r, error } = await svc().from("consulta_asistente")
    .select("id, creado_en, usuario_id, conversacion_id, version, contexto, pregunta, estado, modo, modelo, duracion_ms, texto, respuesta, error, reglas")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`bitácora: ${error.message}`);
  if (!r) return null;

  const [mapa, conversacion, reglas] = await Promise.all([
    r.usuario_id ? nombres([r.usuario_id]) : Promise.resolve(new Map<string, string>()),
    r.conversacion_id
      ? svc().from("conversacion").select("titulo").eq("id", r.conversacion_id).maybeSingle().then((x) => (x.data?.titulo as string | undefined) ?? null)
      : Promise.resolve(null),
    reglasAlResponder((r.reglas as string[] | null) ?? [], r.creado_en as string),
  ]);
  return {
    id: r.id, creado_en: r.creado_en, usuario: (r.usuario_id && mapa.get(r.usuario_id)) || "—", conversacion,
    version: r.version, contexto: r.contexto, pregunta: r.pregunta, estado: r.estado, modo: r.modo, modelo: r.modelo,
    duracion_ms: r.duracion_ms, texto: r.texto, respuesta: r.respuesta as Respuesta | null, error: r.error, reglas,
  };
}

type Foto = { tipo: ReglaAsistente["tipo"]; texto: string } | null;

async function reglasAlResponder(ids: string[], instante: string): Promise<ReglaAplicada[]> {
  if (!ids.length) return [];
  const [cambios, actuales] = await Promise.all([
    svc().from("regla_asistente_cambio").select("regla_id, despues, creado_en").in("regla_id", ids).lte("creado_en", instante)
      .order("creado_en", { ascending: false }),
    svc().from("regla_asistente").select("id").in("id", ids),
  ]);
  if (cambios.error) throw new Error(`bitácora (reglas): ${cambios.error.message}`);
  const vigentes = new Set((actuales.data ?? []).map((x) => x.id as string));
  return ids.map((id) => {
    const foto = (cambios.data ?? []).find((c) => c.regla_id === id && c.despues)?.despues as Foto;
    return { id, tipo: foto?.tipo ?? null, texto: foto?.texto ?? null, vigente: vigentes.has(id) };
  });
}
