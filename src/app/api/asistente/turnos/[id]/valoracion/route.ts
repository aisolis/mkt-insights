import type { NextRequest } from "next/server";
import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import { IdTurno, MAX_COMENTARIO, valorarTurno } from "@/lib/asistente/conversaciones";

const Entrada = z.object({
  /** true = 👍, false = 👎, null = quitar la valoración. */
  util: z.boolean().nullable(),
  comentario: z.string().max(MAX_COMENTARIO).nullish(),
});

/**
 * Valora una respuesta del asistente (G9): { util, comentario? } → { valoracion }. Solo los turnos propios: la
 * base lo vuelve a comprobar con el id del usuario de la sesión; uno ajeno o inexistente responde 404.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/asistente/turnos/[id]/valoracion">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const id = IdTurno.safeParse((await ctx.params).id);
  const entrada = Entrada.safeParse(await request.json().catch(() => null));
  if (!id.success || !entrada.success) return Response.json({ error: `Valoración inválida (comentario de hasta ${MAX_COMENTARIO} caracteres).` }, { status: 400 });
  try {
    const r = await valorarTurno(usuario.id, id.data, entrada.data.util, entrada.data.comentario);
    return r ? Response.json(r) : Response.json({ error: "Respuesta no encontrada" }, { status: 404 });
  } catch (e) {
    console.error("asistente: valoración", e);
    return Response.json({ error: "No se pudo guardar la valoración." }, { status: 500 });
  }
}
