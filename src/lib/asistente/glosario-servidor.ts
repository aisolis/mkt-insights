import "server-only";
import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { EntradaTermino, TOPE_GLOSARIO, type TerminoGlosario, type TerminoValido } from "./glosario";

/**
 * Glosario del asistente (0030_glosario_y_formatos.sql), administrado por un admin en
 * /asistente/configuracion/glosario. La tabla no tiene acceso para anon/authenticated: se lee y cambia con
 * service_role. Quien llama a las funciones de administración ya verificó requerirAdmin(); glosarioActivo() la
 * llama el asistente, que ya verificó el acceso.
 */

type FilaBD = {
  id: string; termino: string; sinonimos: string[]; definicion: string; activo: boolean;
  creado_en: string; actualizado_en: string; creado_por: string | null; actualizado_por: string | null;
};

const tabla = () => createServiceClient().schema("ventas").from("termino_glosario");

/**
 * Términos activos, una vez por petición. Si la lectura falla se responde sin glosario (y queda en el log): el
 * asistente no se cae por una definición.
 */
export const glosarioActivo = cache(async (): Promise<TerminoGlosario[]> => {
  try {
    const { data, error } = await tabla().select("id, termino, sinonimos, definicion").eq("activo", true).order("termino").limit(TOPE_GLOSARIO)
      .returns<Pick<FilaBD, "id" | "termino" | "sinonimos" | "definicion">[]>();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error("asistente: no se pudo leer el glosario; se responde sin él", e);
    return [];
  }
});

// Administración ---------------------------------------------------------------------------------------------------

export type FilaGlosario = TerminoGlosario & { activo: boolean; actualizadoEn: string; actualizadoPor: string | null };

export async function listarGlosario(): Promise<FilaGlosario[]> {
  const { data, error } = await tabla().select("id, termino, sinonimos, definicion, activo, creado_en, actualizado_en, creado_por, actualizado_por")
    .order("termino").limit(TOPE_GLOSARIO).returns<FilaBD[]>();
  if (error) throw new Error(`glosario: ${error.message}`);
  const ids = [...new Set(data.map((f) => f.actualizado_por).filter((x): x is string => !!x))];
  const perfiles = ids.length
    ? (await createServiceClient().from("perfil").select("user_id, nombre").in("user_id", ids).returns<{ user_id: string; nombre: string }[]>()).data ?? []
    : [];
  const nombres = new Map(perfiles.map((p) => [p.user_id, p.nombre]));
  return data.map((f) => ({
    id: f.id, termino: f.termino, sinonimos: f.sinonimos, definicion: f.definicion, activo: f.activo, actualizadoEn: f.actualizado_en,
    actualizadoPor: f.actualizado_por ? nombres.get(f.actualizado_por) ?? "usuario sin perfil" : null,
  }));
}

export type ResultadoTermino = { error?: string; id?: string };

function errorBD(e: { code?: string; message: string }, accion: string): ResultadoTermino {
  if (e.code === "23505") return { error: "Ese término ya está en el glosario. Edítalo en la lista." };
  return { error: e.code === "P0001" ? e.message : `No se pudo ${accion} el término (${e.message}).` };
}

function validar(entrada: EntradaTermino): { datos: TerminoValido } | { error: string } {
  const r = EntradaTermino.safeParse(entrada);
  return r.success ? { datos: r.data } : { error: r.error.issues[0].message };
}

export async function crearTermino(entrada: EntradaTermino, usuarioId: string | null): Promise<ResultadoTermino> {
  const v = validar(entrada);
  if ("error" in v) return v;
  const total = await tabla().select("id", { count: "exact", head: true });
  if ((total.count ?? 0) >= TOPE_GLOSARIO) return { error: `El glosario admite hasta ${TOPE_GLOSARIO} términos. Elimina alguno antes de agregar otro.` };
  const { data, error } = await tabla().insert({ ...v.datos, creado_por: usuarioId, actualizado_por: usuarioId }).select("id").single();
  return error ? errorBD(error, "guardar") : { id: data.id as string };
}

export async function editarTermino(id: string, entrada: EntradaTermino, usuarioId: string | null): Promise<ResultadoTermino> {
  const v = validar(entrada);
  if ("error" in v) return v;
  const { data, error } = await tabla().update({ ...v.datos, actualizado_por: usuarioId, actualizado_en: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return errorBD(error, "guardar");
  return data.length ? { id } : { error: "El término ya no existe; recarga la página." };
}

export async function activarTermino(id: string, activo: boolean, usuarioId: string | null): Promise<ResultadoTermino> {
  const { data, error } = await tabla().update({ activo, actualizado_por: usuarioId, actualizado_en: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return errorBD(error, activo ? "activar" : "desactivar");
  return data.length ? { id } : { error: "El término ya no existe; recarga la página." };
}

export async function eliminarTermino(id: string): Promise<ResultadoTermino> {
  const { data, error } = await tabla().delete().eq("id", id).select("id");
  if (error) return errorBD(error, "eliminar");
  return data.length ? { id } : { error: "El término ya no existe; recarga la página." };
}

/** Carga un archivo ya leído y validado: crea los nuevos y actualiza los existentes, todo o nada (en la base). */
export async function importarGlosario(filas: TerminoValido[], usuarioId: string | null): Promise<{ nuevos: number; actualizados: number } | { error: string }> {
  const { data, error } = await createServiceClient().schema("ventas").rpc("importar_glosario", { p_filas: filas, p_usuario: usuarioId });
  if (error) return { error: error.code === "P0001" ? error.message : `No se pudo cargar el glosario (${error.message}).` };
  return data as { nuevos: number; actualizados: number };
}
