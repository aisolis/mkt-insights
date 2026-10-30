/**
 * Procesa un PDF ya subido al bucket: valida, extrae texto por página, fragmenta, (opcional) calcula embeddings
 * y deja el documento "listo". Recibe un cliente service_role para que la usen el servidor, los scripts y las
 * pruebas por igual (sin server-only).
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { aVector, embeber, type ConfigEmbeddings } from "./embeddings";
import { fragmentar } from "./fragmentar";

export const BUCKET = "conocimiento";
export const MAX_BYTES = 20 * 1024 * 1024;

export async function extraerPaginas(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

export type ResultadoProceso = { estado: "listo"; fragmentos: number; conEmbeddings: boolean } | { estado: "error"; error: string };

export async function procesarDocumento(svc: SupabaseClient, id: string, emb: ConfigEmbeddings | null): Promise<ResultadoProceso> {
  const doc = await svc.schema("conocimiento").from("documento").select("id, ruta_archivo, estado").eq("id", id).single();
  if (doc.error) return { estado: "error", error: "No existe el documento." };
  if (!["subiendo", "error"].includes(doc.data.estado)) return { estado: "error", error: `El documento ya está ${doc.data.estado}.` };

  const fallar = async (error: string): Promise<ResultadoProceso> => {
    await svc.schema("conocimiento").from("documento").update({ estado: "error", error }).eq("id", id);
    return { estado: "error", error };
  };

  const archivo = await svc.storage.from(BUCKET).download(doc.data.ruta_archivo);
  if (archivo.error) return fallar("No se encontró el archivo subido. Vuelve a subirlo.");
  const bytes = new Uint8Array(await archivo.data.arrayBuffer());
  if (bytes.length > MAX_BYTES) return fallar("El archivo pasa de 20 MB.");
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return fallar("El archivo no es un PDF.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const otro = await svc.schema("conocimiento").from("documento").select("titulo").eq("sha256", sha256).in("estado", ["procesando", "listo"]).neq("id", id).maybeSingle();
  if (otro.data) return fallar(`Este archivo ya está cargado como «${otro.data.titulo}».`);

  const marca = await svc.schema("conocimiento").from("documento").update({ estado: "procesando", error: null, bytes: bytes.length, sha256 }).eq("id", id);
  if (marca.error) return fallar(`No se pudo marcar el documento (${marca.error.message}).`);

  let paginas: string[];
  try {
    paginas = await extraerPaginas(bytes.slice());
  } catch (e) {
    return fallar(`No se pudo leer el PDF (${e instanceof Error ? e.message : e}).`);
  }
  const fragmentos = fragmentar(paginas);
  if (!fragmentos.length) return fallar("El PDF no tiene texto seleccionable (¿es un escaneo?). Súbelo con texto o pásalo antes por OCR.");

  let vectores: number[][] | null = null;
  if (emb) {
    try {
      vectores = await embeber(fragmentos.map((f) => f.texto), emb);
    } catch (e) {
      // Sin embeddings igual queda buscable por texto; el script los completa después.
      console.error("conocimiento: embeddings fallaron, queda solo búsqueda de texto", e);
    }
  }

  await svc.schema("conocimiento").from("fragmento").delete().eq("documento_id", id);
  for (let i = 0; i < fragmentos.length; i += 200) {
    const filas = fragmentos.slice(i, i + 200).map((f, j) => ({ documento_id: id, ...f, embedding: vectores ? aVector(vectores[i + j]) : null }));
    const r = await svc.schema("conocimiento").from("fragmento").insert(filas);
    if (r.error) return fallar(`No se pudieron guardar los fragmentos (${r.error.message}).`);
  }
  const fin = await svc.schema("conocimiento").from("documento").update({
    estado: "listo", paginas: paginas.length, fragmentos: fragmentos.length, modelo_embedding: vectores ? emb!.modelo : null, procesado_en: new Date().toISOString(),
  }).eq("id", id);
  if (fin.error) return fallar(`No se pudo cerrar el proceso (${fin.error.message}).`);
  return { estado: "listo", fragmentos: fragmentos.length, conEmbeddings: !!vectores };
}

/** Calcula los embeddings que falten (documentos subidos sin llave o con el modelo caído). */
export async function completarEmbeddings(svc: SupabaseClient, emb: ConfigEmbeddings): Promise<number> {
  let total = 0;
  for (;;) {
    const { data, error } = await svc.schema("conocimiento").from("fragmento").select("id, documento_id, texto").is("embedding", null).order("id").limit(128);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    const vectores = await embeber(data.map((f) => f.texto), emb);
    for (const [i, f] of data.entries()) {
      const r = await svc.schema("conocimiento").from("fragmento").update({ embedding: aVector(vectores[i]) }).eq("id", f.id);
      if (r.error) throw new Error(r.error.message);
    }
    for (const doc of new Set(data.map((f) => f.documento_id))) {
      await svc.schema("conocimiento").from("documento").update({ modelo_embedding: emb.modelo }).eq("id", doc);
    }
    total += data.length;
  }
  return total;
}
