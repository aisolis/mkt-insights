import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { accesoApi } from "@/lib/auth/acceso";
import { agregarAlInforme, IdTurno, quitarDelInforme } from "@/lib/asistente/conversaciones";

const INVALIDO = () => Response.json({ error: "Respuesta inválida" }, { status: 400 });
const FALLO = (e: unknown) => {
  console.error("asistente: informe", e);
  return Response.json({ error: "No se pudo actualizar el informe." }, { status: 500 });
};

/** Agrega la respuesta al informe del usuario (G9) → { enInforme: true }. Ajena o inexistente: 404; informe lleno: 409. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/asistente/turnos/[id]/informe">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const id = IdTurno.safeParse((await ctx.params).id);
  if (!id.success) return INVALIDO();
  try {
    const r = await agregarAlInforme(usuario.id, id.data);
    if (!r) return Response.json({ error: "Respuesta no encontrada" }, { status: 404 });
    if (r.error) return Response.json({ error: r.error }, { status: 409 });
    revalidatePath("/informe");
    return Response.json({ enInforme: true });
  } catch (e) {
    return FALLO(e);
  }
}

/** La quita del informe → { enInforme: false } (también si no estaba). */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/asistente/turnos/[id]/informe">) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const id = IdTurno.safeParse((await ctx.params).id);
  if (!id.success) return INVALIDO();
  try {
    await quitarDelInforme(usuario.id, id.data);
    revalidatePath("/informe");
    return Response.json({ enInforme: false });
  } catch (e) {
    return FALLO(e);
  }
}
