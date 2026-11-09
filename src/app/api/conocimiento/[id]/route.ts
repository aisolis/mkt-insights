import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import { registrarEvento } from "@/lib/auditoria";
import { datosDocumento, urlDocumento } from "@/lib/conocimiento/servidor";

/** Abre el PDF original: revisa sesión y audiencia, y redirige a una URL firmada de 5 minutos. */
export async function GET(_: Request, ctx: RouteContext<"/api/conocimiento/[id]">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response("Documento no válido", { status: 400 });
  const url = await urlDocumento(id);
  if (!url) return new Response("Documento no disponible", { status: 404 });
  await registrarEvento(usuario.id, "documento", { documento: id, ...(await datosDocumento(id)) });
  return Response.redirect(url, 302);
}
