import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Bitácora de accesos y exportaciones (V1-17/20, S31). La escribe el servidor después de comprobar el acceso; nunca
 * hace fallar lo que registra. No guarda clientes, prompts ni secretos: en una exportación, qué se pidió, no su contenido.
 */
export type TipoEvento = "ingreso" | "codigo_fallido" | "salida" | "exportacion" | "documento";
export type Evento = { id: number; usuario: string | null; tipo: TipoEvento; detalle: Record<string, unknown>; creado_en: string };

export const TIPO_EVENTO: Record<TipoEvento, string> = {
  ingreso: "Entró (con 2FA)",
  codigo_fallido: "Código 2FA incorrecto",
  salida: "Salió",
  exportacion: "Exportó",
  documento: "Abrió un documento",
};

/** La frase tras el nombre en la lista de actividad («Ana entró con 2FA»): sin pasar siglas a minúsculas. */
export const FRASE_EVENTO: Record<TipoEvento, string> = {
  ingreso: "entró con 2FA",
  codigo_fallido: "puso un código 2FA incorrecto",
  salida: "salió",
  exportacion: "exportó",
  documento: "abrió un documento",
};

export async function registrarEvento(usuarioId: string | null, tipo: TipoEvento, detalle: Record<string, unknown> = {}) {
  try {
    const { error } = await createServiceClient().schema("ventas").from("evento").insert({ usuario_id: usuarioId, tipo, detalle });
    if (error) console.error(`[auditoria] ${tipo}: ${error.message}`);
  } catch (e) {
    console.error(`[auditoria] ${tipo}:`, e);
  }
}

/** Últimos eventos con el nombre de la persona (solo admin: lo verifica la página). */
export async function eventosRecientes(limite = 200, tipo?: TipoEvento): Promise<Evento[]> {
  const svc = createServiceClient();
  let q = svc.schema("ventas").from("evento").select("id, usuario_id, tipo, detalle, creado_en").order("creado_en", { ascending: false }).limit(limite);
  if (tipo) q = q.eq("tipo", tipo);
  const { data, error } = await q;
  if (error) throw new Error(`eventos: ${error.message}`);
  const ids = [...new Set((data ?? []).map((e) => e.usuario_id).filter(Boolean))] as string[];
  const nombres = ids.length ? (await svc.from("perfil").select("user_id, nombre").in("user_id", ids)).data ?? [] : [];
  const porId = new Map(nombres.map((p) => [p.user_id as string, p.nombre as string]));
  return (data ?? []).map((e) => ({ id: e.id, usuario: e.usuario_id ? porId.get(e.usuario_id) ?? "persona sin perfil" : null, tipo: e.tipo, detalle: e.detalle, creado_en: e.creado_en }));
}

/** Qué se exportó, en palabras, para la lista del admin. */
export function describirEvento(e: Evento): string {
  const d = e.detalle as Record<string, string | number | undefined>;
  if (e.tipo === "exportacion") {
    return [d.que, d.periodo && `periodo ${d.periodo}`, d.comparado && `contra ${d.comparado}`, d.filtros && `filtros: ${d.filtros}`,
      d.version && `v${d.version}`, d.filas !== undefined && `${d.filas} filas`].filter(Boolean).join(" · ");
  }
  if (e.tipo === "documento") return [d.titulo, d.audiencia && `audiencia ${d.audiencia}`].filter(Boolean).join(" · ");
  return "";
}
