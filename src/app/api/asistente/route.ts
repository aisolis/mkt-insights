import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import { configModelo } from "@/lib/asistente/modelo";
import { buscarDocumentos } from "@/lib/conocimiento/servidor";
import { responder } from "@/lib/asistente/responder";
import { leerParams } from "@/lib/dashboard/params";
import * as fuente from "@/lib/semantic/queries";

const Entrada = z.object({
  pregunta: z.string().trim().min(2).max(500),
  /** Query string del dashboard (?periodo=…&canal=…): el asistente hereda periodo, comparación y filtros. */
  contexto: z.string().max(1000).default(""),
  historial: z.array(z.object({ rol: z.enum(["usuario", "asistente"]), texto: z.string().max(2000) })).max(12).default([]),
});

/** Pregunta al asistente sobre la versión publicada. Responde siempre con evidencia y queda en la bitácora. */
export async function POST(request: Request) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const entrada = Entrada.safeParse(await request.json().catch(() => null));
  if (!entrada.success) return Response.json({ error: "Pregunta inválida" }, { status: 400 });

  const version = await fuente.versionVigente();
  if (!version) return Response.json({ error: "Todavía no hay una versión publicada" }, { status: 409 });

  const { pregunta, contexto, historial } = entrada.data;
  const estado = leerParams(Object.fromEntries(new URLSearchParams(contexto)), version.metadatos.periodos);
  const modelo = configModelo();
  const inicio = Date.now();
  const base = { usuario_id: usuario.id, version: version.version, contexto, pregunta, modelo: modelo?.modelo ?? null };
  try {
    const respuesta = await responder(pregunta, historial, { fuente, version, estado, documentos: buscarDocumentos }, modelo);
    await fuente.registrarConsultaAsistente({
      ...base, estado: respuesta.estado, modo: respuesta.modo, texto: respuesta.texto, respuesta, error: null, duracion_ms: Date.now() - inicio,
    });
    return Response.json(respuesta);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await fuente.registrarConsultaAsistente({ ...base, estado: "error", modo: null, texto: null, respuesta: null, error: mensaje, duracion_ms: Date.now() - inicio });
    console.error("asistente:", e);
    return Response.json({ error: "No se pudo responder la pregunta. Quedó registrada para revisión." }, { status: 500 });
  }
}
