/** Tipos del conocimiento propio (G6), compartidos entre servidor, asistente y UI. */
import { z } from "zod";

export const BUCKET = "conocimiento";
export const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Formatos que se aceptan (0030). `unidad` es cómo se llama la «página» de una cita en cada uno: un PDF tiene
 * páginas, un Excel hojas y un Word o un texto se cortan en secciones.
 */
export const TipoDocumento = z.enum(["pdf", "docx", "xlsx", "txt", "md"]);
export type TipoDocumento = z.infer<typeof TipoDocumento>;

export const TIPOS: Record<TipoDocumento, { nombre: string; mime: string; unidad: string; unidades: string; abrev: string }> = {
  pdf: { nombre: "PDF", mime: "application/pdf", unidad: "página", unidades: "págs.", abrev: "pág." },
  docx: { nombre: "Word", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", unidad: "sección", unidades: "secciones", abrev: "sección" },
  xlsx: { nombre: "Excel", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", unidad: "hoja", unidades: "hojas", abrev: "hoja" },
  txt: { nombre: "texto", mime: "text/plain", unidad: "sección", unidades: "secciones", abrev: "sección" },
  md: { nombre: "Markdown", mime: "text/markdown", unidad: "sección", unidades: "secciones", abrev: "sección" },
};

/** El tipo según la extensión del archivo; null si no se acepta. */
export function tipoDeArchivo(nombre: string): TipoDocumento | null {
  const ext = /\.([a-z0-9]+)$/i.exec(nombre.trim())?.[1].toLowerCase();
  const r = TipoDocumento.safeParse(ext);
  return r.success ? r.data : null;
}

export const FORMATOS_ACEPTADOS = "PDF, Word (.docx), Excel (.xlsx) o texto (.txt, .md)";

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
  tipo: TipoDocumento.optional(), // sin dato = PDF (base anterior a 0030)
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
  tipo: TipoDocumento.default("pdf"),
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
  /** Formato del documento; las citas guardadas antes de 0030 no lo traen y son de PDF. */
  tipo?: TipoDocumento;
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
    id, documentoId: e.documento_id, titulo: e.titulo, fuente: e.fuente, fecha: e.fecha_documento, pagina: e.pagina, tipo: e.tipo,
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
