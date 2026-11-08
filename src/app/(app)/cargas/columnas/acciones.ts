"use server";
import { revalidatePath } from "next/cache";
import { requerirGestorCargas } from "@/lib/auth/acceso";
import { CAMPOS, esCampo } from "@/lib/cargas/columnas";
import { DatosColumna, DatosFormato, guardarColumna, guardarFormato, separarLineas } from "@/lib/cargas/columnas-servidor";

export type Estado = { error?: string; ok?: string } | null;

const DESPUES = " Aplica desde la próxima carga; si una carga falló por sus columnas, pruébala abajo y pulsa Reintentar. Lo ya cargado no cambia.";

export async function guardarColumnaAccion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const datos = DatosColumna.safeParse({
    campo: String(form.get("campo") ?? ""),
    encabezados: separarLineas(String(form.get("encabezados") ?? "")),
    obligatoria: form.get("obligatoria") === "on",
  });
  if (!datos.success) return { error: datos.error.issues[0].message };
  const r = await guardarColumna(datos.data, usuario.id);
  if (r.error) return { error: r.error };
  revalidatePath("/cargas/columnas");
  if (r.accion === "sin_cambios") return { ok: "No había nada que cambiar." };
  const etiqueta = esCampo(datos.data.campo) ? CAMPOS[datos.data.campo].etiqueta : datos.data.campo;
  return { ok: `Guardado: ${etiqueta}.${DESPUES}` };
}

export async function guardarFormatoAccion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const datos = DatosFormato.safeParse({ fila: form.get("fila"), hojas: separarLineas(String(form.get("hojas") ?? "")) });
  if (!datos.success) return { error: datos.error.issues[0].message };
  const r = await guardarFormato(datos.data, usuario.id);
  if (r.error) return { error: r.error };
  revalidatePath("/cargas/columnas");
  return r.accion === "sin_cambios" ? { ok: "No había nada que cambiar." } : { ok: `Guardado.${DESPUES}` };
}
