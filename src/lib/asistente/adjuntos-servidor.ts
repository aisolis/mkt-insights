import "server-only";
import { z } from "zod";
import { aVector, configEmbeddings, embeber } from "@/lib/conocimiento/embeddings";
import { createServiceClient } from "@/lib/supabase/server";
import {
  BUCKET_ADJUNTOS, EncontradoAdjunto, FORMATOS_ADJUNTO, MAX_ADJUNTOS, MAX_BYTES_ADJUNTO, MAX_BYTES_IMAGEN, repartirDirectos, tipoDeAdjunto,
  type AdjuntoResumen, type AdjuntosPregunta, type TipoAdjunto,
} from "./adjuntos";
import { procesarAdjunto, type ResultadoAdjunto } from "./adjuntos-proceso";
import { modeloParaPregunta } from "./config-servidor";
import { configVision } from "./vision";

/**
 * Adjuntos de una conversación (0031_adjuntos_conversacion.sql). Las tablas no tienen acceso para
 * anon/authenticated: se leen y escriben con service_role. TODAS las funciones reciben el id del usuario ya
 * verificado (accesoApi) y una conversación que quien llama ya comprobó que es suya con su sesión (RLS, vía
 * obtenerConversacion); además cada consulta filtra por usuario_id, así un id ajeno se comporta como inexistente.
 */

type Fila = {
  id: string; nombre: string; tipo: TipoAdjunto; estado: AdjuntoResumen["estado"] | "quitado"; error: string | null; bytes: number | null;
  paginas: number | null; caracteres: number | null; texto: string | null; creado_en: string;
};
const COLUMNAS = "id, nombre, tipo, estado, error, bytes, paginas, caracteres, creado_en";

const tabla = () => createServiceClient().schema("ventas").from("adjunto");

const aResumen = (f: Omit<Fila, "texto"> & { directo?: boolean }): AdjuntoResumen => ({
  id: f.id, nombre: f.nombre, tipo: f.tipo, estado: f.estado as AdjuntoResumen["estado"], error: f.error, bytes: f.bytes, paginas: f.paginas,
  modo: f.estado === "listo" ? (f.directo ? "directo" : "busqueda") : null,
});

/** Los adjuntos de la conversación que la persona no ha quitado, del más antiguo al más reciente. */
export async function listarAdjuntos(conversacionId: string, usuarioId: string): Promise<AdjuntoResumen[]> {
  const { data, error } = await tabla().select(`${COLUMNAS}, directo:texto`).eq("conversacion_id", conversacionId).eq("usuario_id", usuarioId)
    .neq("estado", "quitado").order("creado_en").order("id").returns<(Omit<Fila, "texto"> & { directo: string | null })[]>();
  if (error) throw new Error(`adjuntos: ${error.message}`);
  return data.map((f) => aResumen({ ...f, directo: f.directo !== null }));
}

export const EntradaAdjunto = z.object({
  nombre: z.string().trim().min(1).max(200).refine((n) => tipoDeAdjunto(n) !== null, `Solo se aceptan archivos ${FORMATOS_ADJUNTO}.`),
  bytes: z.number().int().positive().max(MAX_BYTES_ADJUNTO, "El archivo pasa de 10 MB."),
});

export type SubidaAdjunto = { adjunto: AdjuntoResumen; ruta: string; token: string; mime: string } | { error: string };

/** Registra el adjunto y da una URL firmada para que el navegador suba el archivo directo a Storage. */
export async function prepararAdjunto(conversacionId: string, usuarioId: string, entrada: z.infer<typeof EntradaAdjunto>): Promise<SubidaAdjunto> {
  const t = tipoDeAdjunto(entrada.nombre)!; // EntradaAdjunto ya comprobó la extensión
  if (t.tipo === "imagen" && entrada.bytes > MAX_BYTES_IMAGEN) return { error: "La foto pasa de 5 MB. Súbela con menos resolución." };
  const actuales = await tabla().select("id", { count: "exact", head: true }).eq("conversacion_id", conversacionId).eq("usuario_id", usuarioId).neq("estado", "quitado");
  if (actuales.error) return { error: "No se pudo revisar los adjuntos de la conversación." };
  if ((actuales.count ?? 0) >= MAX_ADJUNTOS) return { error: `Una conversación admite hasta ${MAX_ADJUNTOS} adjuntos. Quita alguno o empieza otra conversación.` };

  const id = crypto.randomUUID();
  const ruta = `${usuarioId}/${conversacionId}/${id}.${t.ext}`;
  const ins = await tabla().insert({ id, conversacion_id: conversacionId, usuario_id: usuarioId, nombre: entrada.nombre, tipo: t.tipo, ruta_archivo: ruta, bytes: entrada.bytes })
    .select(COLUMNAS).single<Omit<Fila, "texto">>();
  if (ins.error) return { error: `No se pudo registrar el adjunto (${ins.error.message}).` };
  const url = await createServiceClient().storage.from(BUCKET_ADJUNTOS).createSignedUploadUrl(ruta);
  if (url.error) {
    await tabla().delete().eq("id", id);
    return { error: `No se pudo preparar la subida (${url.error.message}).` };
  }
  return { adjunto: aResumen(ins.data), ruta, token: url.data.token, mime: t.mime };
}

async function propio(id: string, usuarioId: string) {
  const { data } = await tabla().select("id, tipo, ruta_archivo, conversacion_id, estado").eq("id", id).eq("usuario_id", usuarioId).neq("estado", "quitado")
    .maybeSingle<{ id: string; tipo: TipoAdjunto; ruta_archivo: string; conversacion_id: string; estado: string }>();
  return data;
}

/**
 * Procesa un adjunto propio ya subido. Una foto se lee con el modelo de visión solo si la IA está encendida, el
 * modelo está permitido y el gasto del mes no llegó al tope: leerla cuesta, igual que una pregunta.
 * null = el adjunto no existe o no es de la persona.
 */
export async function procesarAdjuntoPropio(id: string, usuarioId: string): Promise<(ResultadoAdjunto & { adjunto: AdjuntoResumen | null }) | null> {
  const fila = await propio(id, usuarioId);
  if (!fila) return null;
  let vision = null, sinVision: string | undefined;
  if (fila.tipo === "imagen") {
    const decision = await modeloParaPregunta();
    vision = decision.modelo ? configVision() : null;
    if (!vision) {
      sinVision = decision.motivo === "tope_gasto" ? "Se llegó al tope de gasto de IA del mes: por ahora no se pueden leer fotos. Puedes adjuntar el contenido como PDF, Word, Excel o texto."
        : "Leer fotos necesita un modelo de IA con visión y ahora no hay uno disponible. Puedes adjuntar el contenido como PDF, Word, Excel o texto.";
    }
  }
  const r = await procesarAdjunto(createServiceClient(), id, { emb: configEmbeddings(), vision, sinVision });
  const lista = await listarAdjuntos(fila.conversacion_id, usuarioId).catch(() => []);
  return { ...r, adjunto: lista.find((a) => a.id === id) ?? null };
}

/** Quita un adjunto propio: borra el archivo, el texto y los fragmentos; la fila queda (costo y auditoría). */
export async function quitarAdjunto(id: string, usuarioId: string): Promise<boolean> {
  const fila = await propio(id, usuarioId);
  if (!fila) return false;
  const svc = createServiceClient();
  const rm = await svc.storage.from(BUCKET_ADJUNTOS).remove([fila.ruta_archivo]);
  if (rm.error) console.error("adjunto: no se pudo borrar el archivo", rm.error.message);
  await svc.schema("ventas").from("adjunto_fragmento").delete().eq("adjunto_id", id);
  const { error } = await tabla().update({ estado: "quitado", texto: null, fragmentos: 0 }).eq("id", id);
  if (error) throw new Error(`adjuntos (quitar): ${error.message}`);
  return true;
}

/**
 * Los adjuntos listos de la conversación, preparados para una pregunta: los cortos que caben en el presupuesto van
 * enteros y todos se pueden buscar. null si la conversación no tiene adjuntos listos. Si la lectura falla se
 * responde sin adjuntos (y queda en el log): la pregunta sobre los datos de venta no depende de ellos.
 */
export async function adjuntosParaPregunta(conversacionId: string, usuarioId: string): Promise<AdjuntosPregunta | null> {
  try {
    const { data, error } = await tabla().select("id, nombre, tipo, texto").eq("conversacion_id", conversacionId).eq("usuario_id", usuarioId)
      .eq("estado", "listo").order("creado_en").order("id").returns<Pick<Fila, "id" | "nombre" | "tipo" | "texto">[]>();
    if (error) throw error;
    if (!data.length) return null;
    const directos = repartirDirectos(data);
    return {
      ids: data.map((a) => a.id), nombres: data.map((a) => a.nombre), directos,
      porBusqueda: directos.length < data.length,
      buscar: (consulta) => buscarEnAdjuntos(conversacionId, usuarioId, consulta),
    };
  } catch (e) {
    console.error("asistente: no se pudieron leer los adjuntos; se responde sin ellos", e);
    return null;
  }
}

/** Con llave de OpenRouter suma la parte semántica; si falla, sigue solo con texto. */
async function buscarEnAdjuntos(conversacionId: string, usuarioId: string, consulta: string): Promise<EncontradoAdjunto[]> {
  const emb = configEmbeddings();
  let p_embedding: string | null = null;
  if (emb) {
    try {
      p_embedding = aVector((await embeber([consulta], emb))[0]);
    } catch (e) {
      console.error("adjuntos: embedding de la pregunta falló, se busca solo por texto", e);
    }
  }
  const { data, error } = await createServiceClient().schema("ventas").rpc("buscar_adjuntos", {
    p_conversacion: conversacionId, p_usuario: usuarioId, p_texto: consulta, p_embedding, p_limite: 8,
  });
  if (error) throw new Error(`buscar_adjuntos: ${error.message}`);
  return z.array(EncontradoAdjunto).parse(data);
}
