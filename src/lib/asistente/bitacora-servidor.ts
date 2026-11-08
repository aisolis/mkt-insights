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

/** Filtro por valoración del usuario (G9): con 👎 o con 👍. */
export const VALORACIONES = ["negativa", "positiva"] as const;

export const FiltroBitacora = z.object({
  estado: z.enum(ESTADOS).optional().catch(undefined),
  dias: z.enum(["7", "30", "90"]).catch("30").transform(Number),
  usuario: z.uuid().optional().catch(undefined),
  valoracion: z.enum(VALORACIONES).optional().catch(undefined),
});
export type FiltroBitacora = z.infer<typeof FiltroBitacora>;

export type Valoracion = { util: boolean; comentario: string | null };
export type MotivoAutomatico = "tope_gasto" | "modelo_no_permitido";

export type FilaLista = {
  id: number; creado_en: string; usuario: string; usuario_id: string | null; conversacion_id: string | null; version: number | null;
  pregunta: string; estado: Estado; modo: "modelo" | "determinista" | null; modelo: string | null; duracion_ms: number | null;
  reglas: number; respaldo: boolean;
  /** G9: tokens (entrada + salida), costo en dólares (null = sin IA o sin dato), valoración y motivo del modo automático. */
  tokens: number | null; costo_usd: number | null; costo_estimado: boolean; valoracion: Valoracion | null; motivo_automatico: MotivoAutomatico | null;
};

/** Gasto de un modelo en el periodo. */
export type GastoModelo = { modelo: string; preguntas: number; tokens: number; costoUsd: number };

export type Resumen = {
  preguntas: number; personas: number; fueraDeAlcance: number; errores: number; sinDatos: number; respaldo: number; conModelo: number;
  medianaSeg: number | null;
  /** G9: costo total del periodo (filas con dato), cuántas lo tienen estimado, preguntas frenadas por el tope y valoraciones. */
  costoUsd: number; conCosto: number; estimadas: number; porTope: number; tokens: number;
  positivas: number; negativas: number; comentarios: number; porModelo: GastoModelo[];
};

type FilaBD = {
  id: number; creado_en: string; usuario_id: string | null; conversacion_id: string | null; version: number | null; pregunta: string;
  estado: Estado; modo: "modelo" | "determinista" | null; modelo: string | null; duracion_ms: number | null; reglas: string[] | null;
  advertencias: string[] | null; tokens_entrada: number | null; tokens_salida: number | null; costo_usd: number | string | null;
  costo_estimado: boolean; motivo_automatico: MotivoAutomatico | null; valoracion_respuesta: Valoracion | Valoracion[] | null;
};

const unaValoracion = (v: Valoracion | Valoracion[] | null): Valoracion | null => {
  const x = Array.isArray(v) ? v[0] : v;
  return x ? { util: x.util, comentario: x.comentario } : null;
};
const tokensDe = (r: { tokens_entrada: number | null; tokens_salida: number | null }) =>
  r.tokens_entrada === null && r.tokens_salida === null ? null : (r.tokens_entrada ?? 0) + (r.tokens_salida ?? 0);

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
  // Con filtro de valoración, el join es interno: solo quedan las preguntas valoradas así.
  const valoracion = f.valoracion ? "valoracion_respuesta!inner(util, comentario)" : "valoracion_respuesta(util, comentario)";
  let q = svc().from("consulta_asistente")
    .select(`id, creado_en, usuario_id, conversacion_id, version, pregunta, estado, modo, modelo, duracion_ms, reglas, advertencias:respuesta->evidencia->advertencias, tokens_entrada, tokens_salida, costo_usd, costo_estimado, motivo_automatico, ${valoracion}`)
    .gte("creado_en", desde).order("creado_en", { ascending: false }).limit(MAX_FILAS);
  if (f.estado) q = q.eq("estado", f.estado);
  if (f.usuario) q = q.eq("usuario_id", f.usuario);
  if (f.valoracion) q = q.eq("valoracion_respuesta.util", f.valoracion === "positiva");
  const { data, error } = await q.returns<FilaBD[]>();
  if (error) throw new Error(`bitácora: ${error.message}`);
  const filasBD = data ?? [];
  const mapa = await nombres([...new Set(filasBD.map((r) => r.usuario_id).filter((x): x is string => !!x))]);
  const filas = filasBD.map((r): FilaLista => ({
    id: r.id, creado_en: r.creado_en, usuario_id: r.usuario_id, usuario: (r.usuario_id && mapa.get(r.usuario_id)) || "—",
    conversacion_id: r.conversacion_id, version: r.version, pregunta: r.pregunta, estado: r.estado, modo: r.modo, modelo: r.modelo,
    duracion_ms: r.duracion_ms, reglas: r.reglas?.length ?? 0, respaldo: r.modo === "modelo" && esRespaldo(r.advertencias),
    tokens: tokensDe(r), costo_usd: r.costo_usd === null ? null : Number(r.costo_usd), costo_estimado: r.costo_estimado,
    valoracion: unaValoracion(r.valoracion_respuesta), motivo_automatico: r.motivo_automatico,
  }));
  const porModelo = new Map<string, GastoModelo>();
  for (const x of filas) {
    if (!x.modelo || (x.costo_usd === null && x.tokens === null)) continue;
    const g = porModelo.get(x.modelo) ?? { modelo: x.modelo, preguntas: 0, tokens: 0, costoUsd: 0 };
    g.preguntas++;
    g.tokens += x.tokens ?? 0;
    g.costoUsd += x.costo_usd ?? 0;
    porModelo.set(x.modelo, g);
  }
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
    costoUsd: filas.reduce((s, x) => s + (x.costo_usd ?? 0), 0),
    conCosto: filas.filter((x) => x.costo_usd !== null).length,
    estimadas: filas.filter((x) => x.costo_estimado).length,
    porTope: filas.filter((x) => x.motivo_automatico === "tope_gasto").length,
    tokens: filas.reduce((s, x) => s + (x.tokens ?? 0), 0),
    positivas: filas.filter((x) => x.valoracion?.util === true).length,
    negativas: filas.filter((x) => x.valoracion?.util === false).length,
    comentarios: filas.filter((x) => x.valoracion?.comentario).length,
    porModelo: [...porModelo.values()].sort((a, b) => b.costoUsd - a.costoUsd || b.preguntas - a.preguntas),
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
  tokens_entrada: number | null; tokens_salida: number | null; costo_usd: number | null; costo_estimado: boolean;
  motivo_automatico: MotivoAutomatico | null; valoracion: Valoracion | null;
};

/**
 * Una pregunta con todo lo que se registró. Las reglas se muestran como estaban al responder: el texto sale del
 * último cambio anterior a la respuesta en la bitácora de reglas (si se editaron o borraron después, igual se ve).
 */
export async function detalleBitacora(id: number): Promise<Detalle | null> {
  const { data: r, error } = await svc().from("consulta_asistente")
    .select("id, creado_en, usuario_id, conversacion_id, version, contexto, pregunta, estado, modo, modelo, duracion_ms, texto, respuesta, error, reglas, tokens_entrada, tokens_salida, costo_usd, costo_estimado, motivo_automatico, valoracion_respuesta(util, comentario)")
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
    tokens_entrada: r.tokens_entrada, tokens_salida: r.tokens_salida, costo_usd: r.costo_usd === null ? null : Number(r.costo_usd),
    costo_estimado: r.costo_estimado, motivo_automatico: r.motivo_automatico,
    valoracion: unaValoracion(r.valoracion_respuesta as Valoracion | Valoracion[] | null),
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
