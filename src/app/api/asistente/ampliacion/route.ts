import { z } from "zod";
import { accesoApi } from "@/lib/auth/acceso";
import { MAX_MOTIVO } from "@/lib/asistente/presupuesto";
import { solicitarAmpliacion } from "@/lib/asistente/presupuesto-servidor";

const Entrada = z.object({ motivo: z.string().trim().max(MAX_MOTIVO).optional() });

/**
 * La persona pide una ampliación de su presupuesto de IA para este mes. Solo se acepta con el presupuesto agotado
 * y sin otra solicitud pendiente; la resuelve un admin en Configuración del asistente → Presupuestos.
 */
export async function POST(request: Request) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const entrada = Entrada.safeParse(await request.json().catch(() => null));
  if (!entrada.success) return Response.json({ error: `El motivo no puede pasar de ${MAX_MOTIVO} caracteres.` }, { status: 400 });
  try {
    const r = await solicitarAmpliacion(usuario.id, entrada.data.motivo ?? null);
    return "error" in r ? Response.json(r, { status: 409 }) : Response.json({ presupuesto: r.estado });
  } catch (e) {
    console.error("asistente (ampliación):", e);
    return Response.json({ error: "No se pudo enviar la solicitud." }, { status: 500 });
  }
}
