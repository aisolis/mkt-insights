import "server-only";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { aVector, configEmbeddings, embeber } from "./embeddings";
import { BUCKET, MAX_BYTES, procesarDocumento } from "./procesar";
import { DocumentoVisible, Encontrado, type Audiencia, type Buscador } from "./tipos";

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

// Administración (service_role). Las llaman server actions que ya verificaron requerirAdmin(). ------------------

export const MetaDocumento = z.object({
  titulo: z.string().trim().min(3, "El título debe tener al menos 3 caracteres.").max(200),
  fuente: z.string().trim().min(2, "Indica quién produjo el documento.").max(120),
  fecha_documento: z.iso.date().nullable(),
  descripcion: z.string().trim().max(1000).nullable(),
  audiencia: z.enum(["estandar", "plus"]),
  nombre_archivo: z.string().trim().min(1).max(200).regex(/\.pdf$/i, "Solo se aceptan PDF."),
  bytes: z.number().int().positive().max(MAX_BYTES, "El archivo pasa de 20 MB."),
});
export type MetaDocumento = z.infer<typeof MetaDocumento>;

export type Subida = { id: string; ruta: string; token: string } | { error: string };

/** Registra el documento y da una URL firmada para que el navegador suba el PDF directo a Storage (el cuerpo
 * de una función de Vercel no admite archivos grandes). */
export async function prepararSubida(meta: MetaDocumento, subidoPor: string): Promise<Subida> {
  const svc = createServiceClient();
  const id = crypto.randomUUID();
  const ruta = `documentos/${id}.pdf`;
  const ins = await svc.schema("conocimiento").from("documento").insert({ id, ...meta, ruta_archivo: ruta, subido_por: subidoPor });
  if (ins.error) return { error: `No se pudo registrar el documento (${ins.error.message}).` };
  const url = await svc.storage.from(BUCKET).createSignedUploadUrl(ruta);
  if (url.error) return { error: `No se pudo preparar la subida (${url.error.message}).` };
  return { id, ruta, token: url.data.token };
}

export async function procesar(id: string) {
  return procesarDocumento(createServiceClient(), id, configEmbeddings());
}

export type FilaDocumentoAdmin = {
  id: string; titulo: string; fuente: string; fecha_documento: string | null; audiencia: Audiencia; estado: string; error: string | null;
  paginas: number | null; fragmentos: number; modelo_embedding: string | null; nombre_archivo: string; creado_en: string;
};

export async function listarDocumentosAdmin(): Promise<FilaDocumentoAdmin[]> {
  const { data, error } = await createServiceClient().schema("conocimiento").from("documento")
    .select("id, titulo, fuente, fecha_documento, audiencia, estado, error, paginas, fragmentos, modelo_embedding, nombre_archivo, creado_en")
    .order("creado_en", { ascending: false });
  if (error) throw new Error(`documentos: ${error.message}`);
  return data as FilaDocumentoAdmin[];
}

/** Retirar lo saca de la búsqueda y de la lista (el archivo queda para auditoría); reactivar lo devuelve. */
export async function cambiarVigencia(id: string, vigente: boolean): Promise<{ error?: string }> {
  const svc = createServiceClient();
  const doc = await svc.schema("conocimiento").from("documento").select("estado, fragmentos").eq("id", id).single();
  if (doc.error) return { error: "No existe el documento." };
  if (vigente && (doc.data.estado !== "retirado" || doc.data.fragmentos === 0)) return { error: "Solo se reactiva un documento retirado que ya estaba procesado." };
  const r = await svc.schema("conocimiento").from("documento")
    .update(vigente ? { estado: "listo", retirado_en: null } : { estado: "retirado", retirado_en: new Date().toISOString() }).eq("id", id);
  if (r.error) return { error: r.error.code === "23505" ? "Hay otro documento vigente con el mismo archivo." : `No se pudo guardar (${r.error.message}).` };
  return {};
}
