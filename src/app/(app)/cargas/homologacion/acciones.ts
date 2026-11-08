"use server";
import { revalidatePath } from "next/cache";
import { requerirGestorCargas } from "@/lib/auth/acceso";
import { DatosHomologacion, eliminarHomologacion, guardarHomologacion, type ResultadoHomologacion } from "@/lib/cargas/homologacion";

export type Estado = { error?: string; ok?: string } | null;

/** Qué pasó con las cargas sin publicar; lo publicado nunca cambia aquí. */
function resultado(r: ResultadoHomologacion, hecho: string): Estado {
  if (r.error) return { error: r.error };
  revalidatePath("/cargas/homologacion");
  revalidatePath("/cargas"); // las alertas de las cargas sin publicar cambian
  if (r.accion === "sin_cambios") return { ok: "No había nada que cambiar." };
  const cargas = r.cargas ?? [];
  const filas = cargas.reduce((s, c) => s + c.filas, 0);
  const sobreCargas = cargas.length
    ? ` Se actualizó ${cargas.length === 1 ? "1 carga sin publicar" : `${cargas.length} cargas sin publicar`} (${filas.toLocaleString("es-HN")} filas): revisa de nuevo sus alertas.`
    : " No hay cargas sin publicar con ese canal: aplica desde la próxima carga.";
  return { ok: `${hecho}${sobreCargas} Los meses publicados no cambian.` };
}

export async function guardarHomologacionAccion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const elegido = String(form.get("canal") ?? "");
  const nuevo = elegido === "__nuevo";
  const datos = DatosHomologacion.safeParse({
    origen: String(form.get("origen") ?? ""),
    canal: nuevo ? String(form.get("canalNuevo") ?? "") : elegido,
    nuevo: nuevo && form.get("confirmaNuevo") === "on",
  });
  if (!datos.success) return { error: datos.error.issues[0].message };
  if (nuevo && !datos.data.nuevo) return { error: "Confirma que es un canal BIA nuevo." };
  const r = await guardarHomologacion(datos.data, usuario.id);
  return resultado(r, `Guardado: «${datos.data.origen || "(vacío)"}» se muestra como ${datos.data.canal}.`);
}

export async function eliminarHomologacionAccion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const origen = form.get("origen");
  if (typeof origen !== "string" || origen.length > 100) return { error: "Canal de origen no válido." };
  const r = await eliminarHomologacion(origen, usuario.id);
  return resultado(r, `Se quitó la equivalencia de «${origen || "(vacío)"}»: se muestra con su nombre de origen.`);
}
