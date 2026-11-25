import type { NextRequest } from "next/server";
import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import { procesarAdjuntoPropio, quitarAdjunto } from "@/lib/asistente/adjuntos-servidor";

/** Leer una foto con el modelo de visión o un documento largo puede tardar más que el límite por defecto. */
export const maxDuration = 90;

// Un adjunto de otra persona, quitado o inexistente responde igual (404).
const NO_ENCONTRADO = () => Response.json({ error: "Adjunto no encontrado" }, { status: 404 });

/** Paso 2 de adjuntar: con el archivo ya en Storage, lo lee y lo deja listo. También sirve para reintentar. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/asistente/adjuntos/[id]">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NO_ENCONTRADO();
  try {
    const r = await procesarAdjuntoPropio(id, usuario.id);
    return r ? Response.json(r) : NO_ENCONTRADO();
  } catch (e) {
    console.error("asistente (adjuntos):", e);
    return Response.json({ error: "No se pudo leer el adjunto." }, { status: 500 });
  }
}

/** Quitar un adjunto propio: se borran el archivo y su texto; deja de usarse desde la siguiente pregunta. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/asistente/adjuntos/[id]">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NO_ENCONTRADO();
  try {
    return (await quitarAdjunto(id, usuario.id)) ? Response.json({ ok: true }) : NO_ENCONTRADO();
  } catch (e) {
    console.error("asistente (adjuntos):", e);
    return Response.json({ error: "No se pudo quitar el adjunto." }, { status: 500 });
  }
}
