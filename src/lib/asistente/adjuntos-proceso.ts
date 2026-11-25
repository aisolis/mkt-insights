/**
 * Procesa un adjunto ya subido al bucket: valida, saca el texto (documentos con extraer.ts; fotos con el modelo de
 * visión), descarta lo que parece instrucciones para la IA, fragmenta y, si hay llave, calcula embeddings.
 * Recibe un cliente service_role para que lo usen el servidor y las pruebas por igual (sin server-only).
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aVector, embeber, type ConfigEmbeddings } from "@/lib/conocimiento/embeddings";
import { ErrorDocumento, extraerPaginas, firmaInvalida } from "@/lib/conocimiento/extraer";
import { fragmentar } from "@/lib/conocimiento/fragmentar";
import { pareceInstruccion } from "@/lib/conocimiento/inyeccion";
import { BUCKET_ADJUNTOS, MAX_BYTES_ADJUNTO, MAX_BYTES_IMAGEN, MAX_DIRECTO, TipoAdjunto, tipoDeAdjunto } from "./adjuntos";
import { leerImagen, type ConfigVision } from "./vision";

export type ResultadoAdjunto =
  | { estado: "listo"; modo: "directo" | "busqueda"; fragmentos: number; paginas: number }
  | { estado: "error"; error: string };

const FIRMAS_IMAGEN: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

/** `vision`: null si no se pueden leer fotos (sin llave, IA apagada, tope alcanzado); `sinVision` explica por qué. */
export type OpcionesProceso = { emb: ConfigEmbeddings | null; vision: ConfigVision | null; sinVision?: string };

export async function procesarAdjunto(svc: SupabaseClient, id: string, { emb, vision, sinVision }: OpcionesProceso): Promise<ResultadoAdjunto> {
  const tabla = () => svc.schema("ventas").from("adjunto");
  const fila = await tabla().select("id, nombre, tipo, ruta_archivo, estado").eq("id", id).single();
  if (fila.error) return { estado: "error", error: "No existe el adjunto." };
  if (!["subiendo", "error"].includes(fila.data.estado)) return { estado: "error", error: `El adjunto ya está ${fila.data.estado}.` };
  const tipo = TipoAdjunto.parse(fila.data.tipo);

  const fallar = async (error: string): Promise<ResultadoAdjunto> => {
    await tabla().update({ estado: "error", error }).eq("id", id);
    return { estado: "error", error };
  };

  const archivo = await svc.storage.from(BUCKET_ADJUNTOS).download(fila.data.ruta_archivo);
  if (archivo.error) return fallar("No se encontró el archivo subido. Vuelve a adjuntarlo.");
  const bytes = new Uint8Array(await archivo.data.arrayBuffer());
  if (bytes.length > MAX_BYTES_ADJUNTO) return fallar("El archivo pasa de 10 MB.");
  const mime = tipoDeAdjunto(fila.data.nombre)?.mime ?? "";
  if (tipo === "imagen") {
    if (!FIRMAS_IMAGEN[mime]?.(bytes)) return fallar("El archivo no es una imagen PNG, JPG o WebP válida.");
    if (bytes.length > MAX_BYTES_IMAGEN) return fallar("La foto pasa de 5 MB. Súbela con menos resolución.");
    if (!vision) return fallar(sinVision ?? "Ahora no se pueden leer fotos: no hay un modelo de IA con visión disponible.");
  } else {
    const firma = firmaInvalida(bytes, tipo);
    if (firma) return fallar(firma);
  }

  const marca = await tabla().update({ estado: "procesando", error: null, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }).eq("id", id);
  if (marca.error) return fallar(`No se pudo marcar el adjunto (${marca.error.message}).`);

  let paginas: string[];
  let lectura: { modelo_vision: string; tokens_entrada: number | null; tokens_salida: number | null; costo_usd: number | null } | null = null;
  try {
    if (tipo === "imagen") {
      const r = await leerImagen(bytes, mime, vision!);
      const sinDatos = r.uso.sinUso === r.uso.llamadas;
      lectura = {
        modelo_vision: vision!.modelo, tokens_entrada: sinDatos ? null : r.uso.tokensEntrada, tokens_salida: sinDatos ? null : r.uso.tokensSalida,
        costo_usd: sinDatos ? null : Number(r.uso.costoUsd.toFixed(8)),
      };
      // El costo se guarda aunque después falle algo: ya se gastó y cuenta para el tope del mes.
      await tabla().update(lectura).eq("id", id);
      paginas = [r.texto];
    } else paginas = await extraerPaginas(bytes.slice(), tipo);
  } catch (e) {
    if (e instanceof ErrorDocumento) return fallar(e.message);
    console.error("adjunto: no se pudo leer", e);
    return fallar(tipo === "imagen" ? "No se pudo leer la foto. Intenta de nuevo en un momento." : `No se pudo leer el archivo (${e instanceof Error ? e.message : e}).`);
  }

  const fragmentos = fragmentar(paginas);
  const utiles = fragmentos.filter((f) => !pareceInstruccion(f.texto));
  if (!fragmentos.length) {
    return fallar(tipo === "imagen" ? "No se encontró texto ni contenido descriptible en la foto."
      : tipo === "pdf" ? "El PDF no tiene texto seleccionable (¿es un escaneo?). Súbelo como foto de cada página o pásalo antes por OCR."
      : "El archivo no tiene texto que se pueda usar.");
  }
  if (!utiles.length) return fallar("El contenido parece instrucciones para la IA y no se puede usar como adjunto.");

  // Texto directo: solo si es corto, sin el solape entre fragmentos y sin las partes que parecen instrucciones.
  const limpio = fragmentar(paginas, { solape: 0 }).filter((f) => !pareceInstruccion(f.texto)).map((f) => f.texto).join("\n\n");
  const directo = limpio.length <= MAX_DIRECTO && limpio.length > 0;

  let vectores: number[][] | null = null;
  if (emb) {
    try {
      vectores = await embeber(fragmentos.map((f) => f.texto), emb);
    } catch (e) {
      console.error("adjunto: embeddings fallaron, queda solo búsqueda de texto", e); // igual se busca por texto
    }
  }
  await svc.schema("ventas").from("adjunto_fragmento").delete().eq("adjunto_id", id);
  for (let i = 0; i < fragmentos.length; i += 200) {
    const filas = fragmentos.slice(i, i + 200).map((f, j) => ({
      adjunto_id: id, ...f, embedding: vectores ? aVector(vectores[i + j]) : null, sospechoso: pareceInstruccion(f.texto),
    }));
    const r = await svc.schema("ventas").from("adjunto_fragmento").insert(filas);
    if (r.error) return fallar(`No se pudieron guardar los fragmentos (${r.error.message}).`);
  }
  const fin = await tabla().update({
    estado: "listo", paginas: paginas.length, fragmentos: fragmentos.length, caracteres: limpio.length, texto: directo ? limpio : null,
    modelo_embedding: vectores ? emb!.modelo : null, procesado_en: new Date().toISOString(),
  }).eq("id", id);
  if (fin.error) return fallar(`No se pudo cerrar el proceso (${fin.error.message}).`);
  return { estado: "listo", modo: directo ? "directo" : "busqueda", fragmentos: fragmentos.length, paginas: paginas.length };
}
