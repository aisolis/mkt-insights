import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import {
  contarPreguntas, contextoEnPalabras, crearConversacion, historialReciente, IdConversacion, obtenerConversacion,
  registrarTurno, tituloDe, tocarConversacion, type ConversacionResumen,
} from "@/lib/asistente/conversaciones";
import { acotarMemoria, memoriaDe } from "@/lib/asistente/memoria";
import { reglasActivas } from "@/lib/asistente/reglas-servidor";
import { modeloActivo } from "@/lib/asistente/config-servidor";
import { responder } from "@/lib/asistente/responder";
import type { Contexto } from "@/lib/asistente/tipos";
import { buscarDocumentos } from "@/lib/conocimiento/servidor";
import * as fuente from "@/lib/semantic/queries";

const Entrada = z.object({
  pregunta: z.string().trim().min(2).max(500),
  /**
   * Query string del dashboard (?periodo=…&canal=…): el asistente hereda periodo, comparación y filtros.
   * Conversación nueva: es el contexto con el que empieza (si no viene, el periodo por defecto).
   * Conversación existente: si no viene, se usa el guardado en la conversación; si viene, manda para esta
   * pregunta (queda en la bitácora) sin cambiar el de la conversación. La UI no lo manda en conversaciones abiertas.
   */
  contexto: z.string().max(1000).optional(),
  conversacionId: IdConversacion.optional(),
});

/**
 * Pregunta al asistente sobre la versión publicada, dentro de una conversación (G8). El historial y la memoria
 * salen de la base, nunca del cliente: un chat largo no contamina a otro y lo que ve el modelo queda acotado.
 * Responde siempre con evidencia y queda en la bitácora.
 */
export async function POST(request: Request) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const entrada = Entrada.safeParse(await request.json().catch(() => null));
  if (!entrada.success) return Response.json({ error: "Pregunta inválida" }, { status: 400 });

  const version = await fuente.versionVigente();
  if (!version) return Response.json({ error: "Todavía no hay una versión publicada" }, { status: 409 });

  const { pregunta, conversacionId } = entrada.data;
  let conversacion: ConversacionResumen | null;
  try {
    conversacion = conversacionId
      ? await obtenerConversacion(conversacionId) // RLS: la de otro usuario no existe
      : await crearConversacion(usuario.id, tituloDe(pregunta), contextoEnPalabras(entrada.data.contexto ?? "", version).contexto);
  } catch (e) {
    console.error("asistente:", e);
    return Response.json({ error: "No se pudo abrir la conversación." }, { status: 500 });
  }
  if (!conversacion) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });

  const contexto = entrada.data.contexto ?? conversacion.contexto;
  const { estado } = contextoEnPalabras(contexto, version);
  const [{ historial, ultimaOk }, reglas] = await Promise.all([
    conversacionId ? historialReciente(conversacion.id) : { historial: [], ultimaOk: null },
    reglasActivas(), // si fallan, [] y el asistente responde con sus reglas fijas
  ]);
  const ctx: Contexto = { fuente, version, estado, documentos: buscarDocumentos, memoria: acotarMemoria(memoriaDe(ultimaOk), version.metadatos), reglas };

  const modelo = await modeloActivo(); // el elegido en Configuración del asistente (o automático)
  const inicio = Date.now();
  const base = {
    usuario_id: usuario.id, conversacion_id: conversacion.id, version: version.version, contexto, pregunta,
    modelo: modelo?.modelo ?? null, reglas: reglas.map((r) => r.id),
  };
  // Si la base falla al cerrar, la respuesta ya quedó registrada: no se convierte en error ni en un segundo turno.
  const cierre = async () => {
    try {
      const actual = await tocarConversacion(conversacion.id);
      const preguntas = await contarPreguntas(conversacion.id);
      return { conversacionId: conversacion.id, preguntas, conversacion: { ...(actual ?? conversacion), preguntas } };
    } catch (e) {
      console.error("asistente: no se pudo actualizar la conversación", e);
      return { conversacionId: conversacion.id };
    }
  };
  try {
    const respuesta = await responder(pregunta, historial, ctx, modelo);
    await registrarTurno({
      ...base, estado: respuesta.estado, modo: respuesta.modo, texto: respuesta.texto, respuesta, error: null, duracion_ms: Date.now() - inicio,
    });
    return Response.json({ ...respuesta, ...(await cierre()) });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await registrarTurno({ ...base, estado: "error", modo: null, texto: null, respuesta: null, error: mensaje, duracion_ms: Date.now() - inicio });
    console.error("asistente:", e);
    const extra = await cierre();
    return Response.json({ error: "No se pudo responder la pregunta. Quedó registrada para revisión.", ...extra }, { status: 500 });
  }
}
