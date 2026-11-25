import "server-only";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { aVector, configEmbeddings, embeber } from "./embeddings";
import { procesarDocumento } from "./procesar";
import { BUCKET, DocumentoVisible, Encontrado, FORMATOS_ACEPTADOS, MAX_BYTES, TIPOS, tipoDeArchivo, type Audiencia, type Buscador, type TipoDocumento } from "./tipos";

/** Lectura con la sesión de la persona: la base filtra por audiencia y exige 2FA. */
export async function documentosVisibles(): Promise<DocumentoVisible[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("conocimiento").rpc("documentos");
  if (error) throw new Error(`documentos: ${error.message}`);
  return z.array(DocumentoVisible).parse(data);
}

/** Búsqueda para el asistente. Con llave de OpenRouter suma la parte semántica; si falla, sigue solo con texto. */
export const buscarDocumentos: Buscador = async (consulta) => {
  const supabase = await createClient();
  const emb = configEmbeddings();
  let p_embedding: string | null = null;
  if (emb) {
    try {
      p_embedding = aVector((await embeber([consulta], emb))[0]);
    } catch (e) {
      console.error("conocimiento: embedding de la pregunta falló, se busca solo por texto", e);
    }
  }
  const { data, error } = await supabase.schema("conocimiento").rpc("buscar", { p_texto: consulta, p_embedding, p_limite: 8 });
  if (error) throw new Error(`buscar: ${error.message}`);
  return z.array(Encontrado).parse(data);
};

/** URL firmada de 5 minutos si la persona puede ver el documento; null si no. */
export async function urlDocumento(id: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: ruta, error } = await supabase.schema("conocimiento").rpc("ruta_visible", { p_documento: id });
  if (error || typeof ruta !== "string") return null;
  const firmada = await createServiceClient().storage.from(BUCKET).createSignedUrl(ruta, 300);
  return firmada.data?.signedUrl ?? null;
}

/** Título y audiencia de un documento, para la bitácora (después de que urlDocumento comprobó que la persona lo ve). */
export async function datosDocumento(id: string): Promise<{ titulo?: string; audiencia?: string }> {
  const { data } = await createServiceClient().schema("conocimiento").from("documento").select("titulo, audiencia").eq("id", id).maybeSingle();
  return data ?? {};
}

// Administración (service_role). Las llaman server actions que ya verificaron requerirAdmin(). ------------------

export const MetaDocumento = z.object({
  titulo: z.string().trim().min(3, "El título debe tener al menos 3 caracteres.").max(200),
  fuente: z.string().trim().min(2, "Indica quién produjo el documento.").max(120),
  fecha_documento: z.iso.date().nullable(),
  descripcion: z.string().trim().max(1000).nullable(),
  audiencia: z.enum(["estandar", "plus"]),
  propietario: z.string().trim().min(2, "Indica quién es el dueño del documento en BIA.").max(120),
  derechos: z.string().trim().min(3, "Indica de quién son los derechos y qué uso permiten.").max(300),
  vigente_hasta: z.iso.date().nullable(),
  sustituye_a: z.uuid().nullable(),
  nombre_archivo: z.string().trim().min(1).max(200).refine((n) => tipoDeArchivo(n) !== null, `Solo se aceptan archivos ${FORMATOS_ACEPTADOS}.`),
  bytes: z.number().int().positive().max(MAX_BYTES, "El archivo pasa de 20 MB."),
});
export type MetaDocumento = z.infer<typeof MetaDocumento>;

/** `mime`: el tipo de contenido con el que el navegador debe subir el archivo (el bucket solo acepta los de TIPOS). */
export type Subida = { id: string; ruta: string; token: string; mime: string } | { error: string };

/** Registra el documento y da una URL firmada para que el navegador suba el archivo directo a Storage (el cuerpo
 * de una función de Vercel no admite archivos grandes). */
export async function prepararSubida(meta: MetaDocumento, subidoPor: string): Promise<Subida> {
  const svc = createServiceClient();
  const id = crypto.randomUUID();
  const tipo = tipoDeArchivo(meta.nombre_archivo) ?? "pdf"; // MetaDocumento ya comprobó la extensión
  const ruta = `documentos/${id}.${tipo}`;
  let version = 1;
  if (meta.sustituye_a) {
    const ant = await svc.schema("conocimiento").from("documento").select("estado, version").eq("id", meta.sustituye_a).maybeSingle();
    if (!ant.data || ant.data.estado !== "listo") return { error: "El documento que se sustituye ya no está vigente." };
    version = ant.data.version + 1;
  }
  const ins = await svc.schema("conocimiento").from("documento").insert({ id, ...meta, tipo, version, ruta_archivo: ruta, subido_por: subidoPor });
  if (ins.error) return { error: `No se pudo registrar el documento (${ins.error.message}).` };
  const url = await svc.storage.from(BUCKET).createSignedUploadUrl(ruta);
  if (url.error) return { error: `No se pudo preparar la subida (${url.error.message}).` };
  return { id, ruta, token: url.data.token, mime: TIPOS[tipo].mime };
}

/** Procesa el PDF; si sustituye a otro documento, al quedar listo retira el anterior con el motivo (S32). */
export async function procesar(id: string) {
  const svc = createServiceClient();
  const r = await procesarDocumento(svc, id, configEmbeddings());
  if (r.estado !== "listo") return r;
  const doc = await svc.schema("conocimiento").from("documento").select("titulo, version, sustituye_a").eq("id", id).single();
  if (doc.data?.sustituye_a) {
    await svc.schema("conocimiento").from("documento").update({
      estado: "retirado", retirado_en: new Date().toISOString(), motivo_retiro: `Sustituido por «${doc.data.titulo}» (v${doc.data.version}).`,
    }).eq("id", doc.data.sustituye_a).eq("estado", "listo");
  }
  return r;
}

export type FilaDocumentoAdmin = {
  id: string; titulo: string; fuente: string; fecha_documento: string | null; audiencia: Audiencia; estado: string; error: string | null;
  paginas: number | null; fragmentos: number; modelo_embedding: string | null; nombre_archivo: string; creado_en: string;
  propietario: string | null; derechos: string | null; vigente_hasta: string | null; version: number; sustituye_a: string | null;
  motivo_retiro: string | null; fragmentos_sospechosos: number; tipo: TipoDocumento;
};

export async function listarDocumentosAdmin(): Promise<FilaDocumentoAdmin[]> {
  const { data, error } = await createServiceClient().schema("conocimiento").from("documento")
    .select("id, titulo, fuente, fecha_documento, audiencia, estado, error, paginas, fragmentos, modelo_embedding, nombre_archivo, creado_en, propietario, derechos, vigente_hasta, version, sustituye_a, motivo_retiro, fragmentos_sospechosos, tipo")
    .order("creado_en", { ascending: false });
  if (error) throw new Error(`documentos: ${error.message}`);
  return data as FilaDocumentoAdmin[];
}

/** Retirar lo saca de la búsqueda y de la lista (el archivo queda para auditoría); reactivar lo devuelve. */
export async function cambiarVigencia(id: string, vigente: boolean, motivo: string | null = null): Promise<{ error?: string }> {
  const svc = createServiceClient();
  const doc = await svc.schema("conocimiento").from("documento").select("estado, fragmentos").eq("id", id).single();
  if (doc.error) return { error: "No existe el documento." };
  if (vigente && (doc.data.estado !== "retirado" || doc.data.fragmentos === 0)) return { error: "Solo se reactiva un documento retirado que ya estaba procesado." };
  const r = await svc.schema("conocimiento").from("documento")
    .update(vigente ? { estado: "listo", retirado_en: null, motivo_retiro: null } : { estado: "retirado", retirado_en: new Date().toISOString(), motivo_retiro: motivo }).eq("id", id);
  if (r.error) return { error: r.error.code === "23505" ? "Hay otro documento vigente con el mismo archivo." : `No se pudo guardar (${r.error.message}).` };
  return {};
}
