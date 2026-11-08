"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requerirAcceso } from "@/lib/auth/acceso";
import {
  editarItemInforme, IdTurno, MAX_NOTA_INFORME, MAX_TITULO_INFORME, ordenarInforme, quitarDelInforme,
} from "@/lib/asistente/conversaciones";

/**
 * Cambios al informe del usuario (G9). Cada acción verifica la sesión (el layout no se vuelve a ejecutar) y la
 * base solo toca filas de ese usuario: un id ajeno no cambia nada.
 */
export type ResultadoInforme = { error?: string };

export async function quitarDelInformeAccion(turnoId: number): Promise<ResultadoInforme> {
  const usuario = await requerirAcceso();
  const id = IdTurno.safeParse(turnoId);
  if (!id.success) return { error: "Respuesta inválida." };
  await quitarDelInforme(usuario.id, id.data);
  revalidatePath("/informe");
  return {};
}

const Edicion = z.object({ titulo: z.string().max(MAX_TITULO_INFORME), nota: z.string().max(MAX_NOTA_INFORME) });

export async function editarItemAccion(turnoId: number, titulo: string, nota: string): Promise<ResultadoInforme> {
  const usuario = await requerirAcceso();
  const id = IdTurno.safeParse(turnoId);
  const e = Edicion.safeParse({ titulo, nota });
  if (!id.success || !e.success) return { error: `El título admite hasta ${MAX_TITULO_INFORME} caracteres y la nota hasta ${MAX_NOTA_INFORME}.` };
  if (!(await editarItemInforme(usuario.id, id.data, e.data.titulo, e.data.nota))) return { error: "Esa respuesta ya no está en tu informe." };
  revalidatePath("/informe");
  return {};
}

export async function ordenarInformeAccion(turnoIds: number[]): Promise<ResultadoInforme> {
  const usuario = await requerirAcceso();
  const ids = z.array(IdTurno).max(200).safeParse(turnoIds);
  if (!ids.success) return { error: "Orden inválido." };
  const ok = await ordenarInforme(usuario.id, ids.data);
  revalidatePath("/informe");
  return ok ? {} : { error: "El informe cambió en otra pestaña; se recargó el orden guardado." };
}
