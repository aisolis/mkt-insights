import type { NextRequest } from "next/server";
import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import {
  archivarConversacion, cargarTurnos, contextoEnPalabras, obtenerConversacion, renombrarConversacion, Titulo,
} from "@/lib/asistente/conversaciones";
import { versionVigente } from "@/lib/semantic/queries";

// RLS: una conversación de otro usuario, archivada o inexistente responde igual (404).
const NO_ENCONTRADA = () => Response.json({ error: "Conversación no encontrada" }, { status: 404 });
const FALLO = (e: unknown) => {
  console.error("asistente:", e);
  return Response.json({ error: "No se pudo completar la operación." }, { status: 500 });
};

/** Una conversación con sus turnos (respuesta completa guardada) y su contexto en palabras para el chip. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/asistente/conversaciones/[id]">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const { id } = await ctx.params;
  try {
    const conversacion = await obtenerConversacion(id);
    if (!conversacion) return NO_ENCONTRADA();
    const [turnos, version] = await Promise.all([cargarTurnos(id), versionVigente()]);
    const contextoTxt = version ? contextoEnPalabras(conversacion.contexto, version).texto : "";
    return Response.json({ conversacion, contextoTxt, turnos });
  } catch (e) {
    return FALLO(e);
  }
}

/** Renombrar: { titulo }. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/asistente/conversaciones/[id]">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const { id } = await ctx.params;
  const entrada = z.object({ titulo: Titulo }).safeParse(await request.json().catch(() => null));
  if (!entrada.success) return Response.json({ error: "El título debe tener entre 1 y 120 caracteres." }, { status: 400 });
  try {
    const conversacion = await renombrarConversacion(id, entrada.data.titulo);
    return conversacion ? Response.json({ conversacion }) : NO_ENCONTRADA();
  } catch (e) {
    return FALLO(e);
  }
}

/** Archivar (el "borrar" del usuario): deja de listarse; los turnos siguen en la bitácora. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/asistente/conversaciones/[id]">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const { id } = await ctx.params;
  try {
    return (await archivarConversacion(id)) ? Response.json({ ok: true }) : NO_ENCONTRADA();
  } catch (e) {
    return FALLO(e);
  }
}
