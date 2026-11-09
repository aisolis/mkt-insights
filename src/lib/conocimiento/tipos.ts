/** Tipos del conocimiento propio (G6), compartidos entre servidor, asistente y UI. */
import { z } from "zod";

export const BUCKET = "conocimiento";
export const MAX_BYTES = 20 * 1024 * 1024;

export const Audiencia = z.enum(["estandar", "plus"]);
export type Audiencia = z.infer<typeof Audiencia>;

/** Lo que devuelve conocimiento.buscar por fragmento. */
export const Encontrado = z.object({
  fragmento_id: z.number(),
  documento_id: z.string(),
  titulo: z.string(),
  fuente: z.string(),
  fecha_documento: z.string().nullable(),
  pagina: z.number(),
  texto: z.string(),
  coincidencias: z.number(),
  terminos: z.number(),
  similitud: z.number().nullable(),
  puntaje: z.number(),
});
export type Encontrado = z.infer<typeof Encontrado>;

export const DocumentoVisible = z.object({
  id: z.string(),
  titulo: z.string(),
  fuente: z.string(),
  fecha_documento: z.string().nullable(),
  descripcion: z.string().nullable(),
  audiencia: Audiencia,
  paginas: z.number().nullable(),
  creado_en: z.string(),
  propietario: z.string().nullable().default(null),
  vigente_hasta: z.string().nullable().default(null),
  version: z.number().default(1),
});
export type DocumentoVisible = z.infer<typeof DocumentoVisible>;

/** Cita que muestra el asistente: contexto de un documento autorizado, nunca un hecho del cubo. */
export type Cita = {
  id: string; // d1, d2…
  documentoId: string;
  titulo: string;
  fuente: string;
  fecha: string | null;
  pagina: number;
  extracto: string;
};

export type Buscador = (consulta: string) => Promise<Encontrado[]>;

/**
 * Relevante para mostrarse sin que el modelo lo elija: comparte al menos 2 términos con la pregunta (o todos si
 * la pregunta tiene uno solo), o es semánticamente cercano. Evita citar un estudio solo porque dice "venta".
 */
// Umbral de baai/bge-m3: con un estudio de prueba, las preguntas relacionadas (incluidas paráfrasis sin palabras en
// común) dieron 0.53–0.63 y las no relacionadas 0.36–0.46. Recalibrar con estudios reales.
export function esRelevante(e: Encontrado, umbralSimilitud = 0.5) {
  if (e.similitud !== null && e.similitud >= umbralSimilitud) return true;
  return e.coincidencias >= Math.min(2, e.terminos);
}

export function aCita(e: Encontrado, id: string, largo = 600): Cita {
  const t = e.texto.replace(/\s+/g, " ").trim();
  return {
    id, documentoId: e.documento_id, titulo: e.titulo, fuente: e.fuente, fecha: e.fecha_documento, pagina: e.pagina,
    extracto: t.length > largo ? `${t.slice(0, largo).replace(/\s+\S*$/, "")}…` : t,
  };
}

/** Hasta `max` fragmentos relevantes, primero uno por documento y después el resto por puntaje. */
export function elegirCitas(encontrados: Encontrado[], max = 3): Cita[] {
  const relevantes = encontrados.filter((e) => esRelevante(e));
  const vistos = new Set<string>();
  const primero = relevantes.filter((e) => !vistos.has(e.documento_id) && vistos.add(e.documento_id));
  const resto = relevantes.filter((e) => !primero.includes(e));
  return [...primero, ...resto].slice(0, max).map((e, i) => aCita(e, `d${i + 1}`));
}
