import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { estadoPresupuesto, FilaPresupuesto, MAX_MOTIVO, SIN_LIMITE, type EstadoPresupuesto, type Solicitud } from "./presupuesto";

/**
 * Presupuesto de IA por persona (0032_presupuesto_ia_usuario.sql). Las tablas no tienen acceso para
 * anon/authenticated: todo va con service_role por funciones de la base. Quien llama ya verificó la sesión
 * (accesoApi para lo propio, requerirAdmin para administrar) y pasa el id del usuario verificado.
 */

const svc = () => createServiceClient().schema("ventas");
const errorBD = (e: { code?: string; message: string }, accion: string) =>
  ({ error: e.code === "P0001" || e.code === "P0002" || e.code === "22023" ? e.message : `No se pudo ${accion} (${e.message}).` });

/**
 * Presupuesto del mes de una persona. Si no se puede leer, se la trata como sin límite (y queda en el log): el
 * presupuesto es un freno de costos, no una razón para dejar de responder; el tope global sigue protegiendo el gasto.
 */
export async function presupuestoDe(usuarioId: string): Promise<EstadoPresupuesto> {
  try {
    const { data, error } = await svc().rpc("presupuestos_ia", { p_usuario: usuarioId });
    if (error) throw error;
    const fila = z.array(FilaPresupuesto).parse(data)[0];
    return fila ? estadoPresupuesto(fila) : SIN_LIMITE;
  } catch (e) {
    console.error("asistente: no se pudo leer el presupuesto de la persona", e);
    return SIN_LIMITE;
  }
}

/** La persona pide una ampliación para este mes. Solo tiene sentido con el presupuesto agotado y sin otra pendiente. */
export async function solicitarAmpliacion(usuarioId: string, motivo: string | null): Promise<{ estado: EstadoPresupuesto } | { error: string }> {
  const actual = await presupuestoDe(usuarioId);
  if (actual.limiteUsd === null) return { error: "No tienes un límite de presupuesto de IA: no hace falta ampliarlo." };
  if (!actual.agotado) return { error: "Todavía te queda presupuesto de IA este mes." };
  if (actual.pendiente) return { error: "Ya tienes una solicitud pendiente este mes." };
  const { error } = await svc().rpc("solicitar_ampliacion_ia", { p_usuario: usuarioId, p_motivo: motivo?.trim().slice(0, MAX_MOTIVO) || null });
  if (error) return errorBD(error, "enviar la solicitud");
  return { estado: { ...actual, pendiente: true } };
}

// Administración ---------------------------------------------------------------------------------------------------

/** Presupuesto y gasto del mes de todas las personas con perfil. */
export async function presupuestosDelMes(): Promise<FilaPresupuesto[]> {
  const { data, error } = await svc().rpc("presupuestos_ia", { p_usuario: null });
  if (error) throw new Error(`presupuestos de IA: ${error.message}`);
  return z.array(FilaPresupuesto).parse(data);
}

/**
 * Presupuesto mensual general por persona (null = sin límite). Se lee aparte de leerConfig() a propósito: si esta
 * columna faltara (código publicado antes que la migración), la configuración del modelo no debe verse afectada.
 */
export async function presupuestoGeneral(): Promise<number | null> {
  const { data, error } = await svc().from("config_asistente").select("presupuesto_usuario_usd").maybeSingle<{ presupuesto_usuario_usd: number | string | null }>();
  if (error) throw new Error(`presupuesto general: ${error.message}`);
  return data?.presupuesto_usuario_usd === null || data?.presupuesto_usuario_usd === undefined ? null : Number(data.presupuesto_usuario_usd);
}

export async function guardarPresupuestoGeneral(monto: number | null, adminId: string): Promise<{ error?: string }> {
  const { error } = await svc().rpc("guardar_presupuesto_general", { p_monto: monto, p_usuario: adminId });
  return error ? errorBD(error, "guardar el presupuesto") : {};
}

/** `monto` nulo y `sinLimite` falso: la persona vuelve al presupuesto general. */
export async function guardarPresupuestoDe(usuarioId: string, monto: number | null, sinLimite: boolean, adminId: string): Promise<{ error?: string }> {
  const { error } = await svc().rpc("guardar_presupuesto_ia", { p_usuario: usuarioId, p_monto: monto, p_sin_limite: sinLimite, p_admin: adminId });
  return error ? errorBD(error, "guardar el presupuesto") : {};
}

type FilaSolicitud = {
  id: number; usuario_id: string; mes: string; motivo: string | null; estado: Solicitud["estado"]; monto_usd: number | string | null;
  respuesta: string | null; solicitada_en: string; resuelta_en: string | null; resuelta_por: string | null;
};

/** Solicitudes de ampliación: primero las pendientes, después las resueltas más recientes. */
export async function listarSolicitudes(limite = 30): Promise<Solicitud[]> {
  const { data, error } = await svc().from("ampliacion_ia")
    .select("id, usuario_id, mes, motivo, estado, monto_usd, respuesta, solicitada_en, resuelta_en, resuelta_por")
    .order("solicitada_en", { ascending: false }).limit(limite).returns<FilaSolicitud[]>();
  if (error) throw new Error(`solicitudes de ampliación: ${error.message}`);
  const ids = [...new Set(data.flatMap((s) => [s.usuario_id, s.resuelta_por]).filter((x): x is string => !!x))];
  const perfiles = ids.length
    ? (await createServiceClient().from("perfil").select("user_id, nombre").in("user_id", ids).returns<{ user_id: string; nombre: string }[]>()).data ?? []
    : [];
  const nombres = new Map(perfiles.map((p) => [p.user_id, p.nombre]));
  const filas = data.map((s): Solicitud => ({
    id: s.id, usuarioId: s.usuario_id, nombre: nombres.get(s.usuario_id) ?? "persona sin perfil", mes: s.mes, motivo: s.motivo, estado: s.estado,
    montoUsd: s.monto_usd === null ? null : Number(s.monto_usd), respuesta: s.respuesta, solicitadaEn: s.solicitada_en, resueltaEn: s.resuelta_en,
    resueltaPor: s.resuelta_por ? nombres.get(s.resuelta_por) ?? "usuario sin perfil" : null,
  }));
  return [...filas.filter((s) => s.estado === "pendiente"), ...filas.filter((s) => s.estado !== "pendiente")];
}

/** Aprueba (con un monto, que vale solo ese mes) o rechaza una solicitud pendiente. */
export async function resolverSolicitud(id: number, aprobar: boolean, monto: number | null, respuesta: string | null, adminId: string): Promise<{ error?: string }> {
  const { error } = await svc().rpc("resolver_ampliacion_ia", {
    p_id: id, p_aprobar: aprobar, p_monto: aprobar ? monto : null, p_respuesta: respuesta?.trim().slice(0, MAX_MOTIVO) || null, p_admin: adminId,
  });
  return error ? errorBD(error, "resolver la solicitud") : {};
}
