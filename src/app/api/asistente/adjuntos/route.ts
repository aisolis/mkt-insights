import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import { EntradaAdjunto, prepararAdjunto } from "@/lib/asistente/adjuntos-servidor";
import {
  contextoEnPalabras, crearConversacion, IdConversacion, MAX_TITULO, obtenerConversacion, TITULO_ADJUNTO, tituloDe,
} from "@/lib/asistente/conversaciones";
import { versionVigente } from "@/lib/semantic/queries";

const Entrada = EntradaAdjunto.extend({
  conversacionId: IdConversacion.optional(),
  /** Query string del dashboard, solo si el adjunto abre una conversación nueva. */
  contexto: z.string().max(1000).optional(),
});

/**
 * Paso 1 de adjuntar: registra el archivo en una conversación del usuario y devuelve la URL firmada para que el
 * navegador lo suba directo a Storage. Sin conversación abierta se crea una, con el nombre del archivo como título
 * provisional (la primera pregunta le pone el suyo).
 */
export async function POST(request: Request) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const entrada = Entrada.safeParse(await request.json().catch(() => null));
  if (!entrada.success) return Response.json({ error: entrada.error.issues[0].message }, { status: 400 });
  const { conversacionId, contexto, ...archivo } = entrada.data;

  try {
    let conversacion = conversacionId ? await obtenerConversacion(conversacionId) : null; // RLS: la de otro usuario no existe
    if (conversacionId && !conversacion) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });
    let nueva: { contexto: string; contextoTxt: string } | null = null;
    if (!conversacion) {
      const version = await versionVigente();
      if (!version) return Response.json({ error: "Todavía no hay una versión publicada" }, { status: 409 });
      const c = contextoEnPalabras(contexto ?? "", version);
      conversacion = await crearConversacion(usuario.id, tituloDe(`${TITULO_ADJUNTO}${archivo.nombre}`, MAX_TITULO), c.contexto);
      nueva = { contexto: c.contexto, contextoTxt: c.texto };
    }
    const subida = await prepararAdjunto(conversacion.id, usuario.id, archivo);
    // La conversación recién creada se devuelve aunque el adjunto falle: el chat ya quedó en ella.
    return Response.json({ ...subida, conversacion, ...(nueva ?? {}) }, { status: "error" in subida ? 400 : 200 });
  } catch (e) {
    console.error("asistente (adjuntos):", e);
    return Response.json({ error: "No se pudo adjuntar el archivo." }, { status: 500 });
  }
}
