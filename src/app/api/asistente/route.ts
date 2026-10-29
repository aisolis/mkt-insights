import { z } from "zod";
import { configModelo } from "@/lib/asistente/modelo";
import { responder } from "@/lib/asistente/responder";
import { leerParams } from "@/lib/dashboard/params";
import * as fuente from "@/lib/semantic/queries";

const Entrada = z.object({
  pregunta: z.string().trim().min(2).max(500),
  /** Query string del dashboard (?periodo=…&canal=…): el asistente hereda periodo, comparación y filtros. */
  contexto: z.string().max(1000).default(""),
  historial: z.array(z.object({ rol: z.enum(["usuario", "asistente"]), texto: z.string().max(2000) })).max(12).default([]),
});

/** Pregunta al asistente sobre la versión publicada. Responde siempre con evidencia (src/lib/asistente). */
export async function POST(request: Request) {
  const entrada = Entrada.safeParse(await request.json().catch(() => null));
  if (!entrada.success) return Response.json({ error: "Pregunta inválida" }, { status: 400 });

  const version = await fuente.versionVigente();
  if (!version) return Response.json({ error: "Todavía no hay una versión publicada" }, { status: 409 });

  const { pregunta, contexto, historial } = entrada.data;
  const estado = leerParams(Object.fromEntries(new URLSearchParams(contexto)), version.metadatos.periodos);
  const respuesta = await responder(pregunta, historial, { fuente, version, estado }, configModelo());
  return Response.json(respuesta);
}
