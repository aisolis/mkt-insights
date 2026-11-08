import { accesoApi } from "@/lib/auth/acceso";
import { listarConversaciones } from "@/lib/asistente/conversaciones";

/** Las últimas conversaciones del usuario (sin archivar), con su número de preguntas. */
export async function GET() {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  try {
    return Response.json({ conversaciones: await listarConversaciones() });
  } catch (e) {
    console.error("asistente:", e);
    return Response.json({ error: "No se pudieron cargar las conversaciones." }, { status: 500 });
  }
}
