import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import { gestionaCargas } from "@/lib/auth/reglas";
import { procesar } from "@/lib/cargas/servidor";

/** Un mes son ~60 mil filas: lectura del Excel e inserción en lotes toman más que el límite por defecto. */
export const maxDuration = 300;

/** Procesa una carga ya subida a Storage (paso 2 de "Cargas y versiones"). También sirve para reintentar. */
export async function POST(_: Request, ctx: RouteContext<"/api/cargas/[id]/procesar">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  if (!gestionaCargas(usuario)) return Response.json({ error: "Solo admin o aprobador cargan el cubo" }, { status: 403 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Carga no válida" }, { status: 400 });
  return Response.json(await procesar(id));
}
