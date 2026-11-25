import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import {
  contarPreguntas, contextoEnPalabras, crearConversacion, historialReciente, IdConversacion, MAX_TITULO, obtenerConversacion,
  registrarTurno, renombrarConversacion, TITULO_ADJUNTO, tituloDe, tocarConversacion, type ConversacionResumen,
} from "@/lib/asistente/conversaciones";
import { adjuntosParaPregunta } from "@/lib/asistente/adjuntos-servidor";
import { acotarMemoria, memoriaDe } from "@/lib/asistente/memoria";
import { terminosEnPregunta } from "@/lib/asistente/glosario";
import { glosarioActivo } from "@/lib/asistente/glosario-servidor";
import { reglasActivas } from "@/lib/asistente/reglas-servidor";
import { columnasUso, modeloParaPregunta } from "@/lib/asistente/config-servidor";
import { usoVacio } from "@/lib/asistente/modelo";
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
  const [{ historial, ultimaOk }, reglas, terminos, adjuntos] = await Promise.all([
    conversacionId ? historialReciente(conversacion.id) : { historial: [], ultimaOk: null },
    reglasActivas(), // si fallan, [] y el asistente responde con sus reglas fijas
    glosarioActivo(), // si falla, [] y se responde sin glosario
    // Archivos o fotos que la persona subió a esta conversación (que ya se comprobó que es suya); si falla, sin ellos.
    conversacionId ? adjuntosParaPregunta(conversacion.id, usuario.id) : null,
  ]);
  // Una conversación que empezó con un adjunto lleva el nombre del archivo: la primera pregunta le da su título.
  if (conversacionId && conversacion.preguntas === 0 && conversacion.titulo.startsWith(TITULO_ADJUNTO)) {
    conversacion = (await renombrarConversacion(conversacion.id, tituloDe(pregunta, MAX_TITULO)).catch(() => null)) ?? conversacion;
  }
  // Del glosario solo van al modelo los términos de esta pregunta (y, con menos peso, los de la pregunta anterior,
  // para «¿y eso cómo se calcula?»).
  const anterior = historial.filter((t) => t.rol === "usuario").at(-1)?.texto;
  const glosario = terminosEnPregunta(anterior ? [pregunta, anterior] : [pregunta], terminos);
  const ctx: Contexto = { fuente, version, estado, documentos: buscarDocumentos, memoria: acotarMemoria(memoriaDe(ultimaOk), version.metadatos), reglas, glosario, ...(adjuntos ? { adjuntos } : {}) };

  // El elegido en Configuración del asistente (o automático). Con el tope de gasto del mes alcanzado o un modelo
  // fuera de la lista de permitidos responde el análisis automático, con aviso y marcado en la bitácora (G9).
  const { modelo, aviso, motivo } = await modeloParaPregunta();
  const uso = usoVacio(); // tokens y costo de todas las rondas, también si la pregunta termina en error
  const inicio = Date.now();
  const base = {
    usuario_id: usuario.id, conversacion_id: conversacion.id, version: version.version, contexto, pregunta,
    modelo: modelo?.modelo ?? null, reglas: reglas.map((r) => r.id), motivo_automatico: motivo,
    glosario: modelo ? glosario.map((t) => t.id) : null, // solo el modelo recibe el glosario
    adjuntos: adjuntos?.ids ?? null,
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
    const respuesta = await responder(pregunta, historial, ctx, modelo, { uso, aviso });
    const duracion_ms = Date.now() - inicio;
    const turnoId = await registrarTurno({
      ...base, ...(await columnasUso(uso, modelo?.modelo ?? null)),
      estado: respuesta.estado, modo: respuesta.modo, texto: respuesta.texto, respuesta, error: null, duracion_ms,
    });
    // turnoId: para valorar la respuesta o agregarla al informe (null si la bitácora falló).
    return Response.json({ ...respuesta, turnoId, ...(await cierre()) });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    const duracion_ms = Date.now() - inicio;
    await registrarTurno({
      ...base, ...(await columnasUso(uso, modelo?.modelo ?? null).catch(() => ({}))),
      estado: "error", modo: null, texto: null, respuesta: null, error: mensaje, duracion_ms,
    });
    console.error("asistente:", e);
    const extra = await cierre();
    return Response.json({ error: "No se pudo responder la pregunta. Quedó registrada para revisión.", ...extra }, { status: 500 });
  }
}
