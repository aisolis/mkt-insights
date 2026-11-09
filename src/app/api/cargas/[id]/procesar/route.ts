import { after } from "next/server";
import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import { gestionaCargas } from "@/lib/auth/reglas";
import { ejecutarProceso, iniciarProceso } from "@/lib/cargas/servidor";

/** El trabajo sigue después de responder (after): lectura del Excel e inserción en lotes toman más que el límite por defecto. */
export const maxDuration = 300;

/**
 * Inicia el proceso de una carga ya subida a Storage (paso 2 de "Cargas y versiones"), también para reintentar.
 * Responde al momento (202) y procesa en segundo plano; la página sigue la etapa y el avance desde la base (S30).
 */
export async function POST(_: Request, ctx: RouteContext<"/api/cargas/[id]/procesar">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  if (!gestionaCargas(usuario)) return Response.json({ error: "Solo admin o aprobador cargan el cubo" }, { status: 403 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Carga no válida" }, { status: 400 });
  const t = await iniciarProceso(id);
  if ("error" in t) return Response.json({ estado: "con_errores", error: t.error }, { status: 409 });
  after(async () => {
    const r = await ejecutarProceso(id, t.intento);
    if (r.estado === "con_errores") console.info(`[cargas] ${id} intento ${t.intento}: ${r.error}`);
  });
  return Response.json({ estado: "procesando" }, { status: 202 });
}
