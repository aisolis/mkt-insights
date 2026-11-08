import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import type { CambioHomologacion, CanalPendiente, Homologacion } from "./tipos";

/**
 * Homologación de canales desde la app (S2, S19). Service_role: lo llaman la página y las server actions que ya
 * verificaron requerirGestorCargas(). Los cambios van por funciones SQL que dejan la bitácora y vuelven a aplicar
 * la equivalencia a las cargas validadas sin publicar; los meses publicados no se tocan (0016_operacion.sql).
 */

export async function homologacionesCanal(): Promise<Homologacion[]> {
  const { data, error } = await createServiceClient().schema("ventas").from("homologacion")
    .select("valor_origen, valor_homologado, revisar").eq("dimension", "canal")
    .order("valor_homologado").order("valor_origen");
  if (error) throw new Error(`homologación: ${error.message}`);
  return data as Homologacion[];
}

/** Canales BIA en uso (destinos de la homologación), para elegir uno sin inventar variantes de escritura. */
export const canalesBia = (h: Homologacion[]) => [...new Set(h.map((x) => x.valor_homologado))].sort((a, b) => a.localeCompare(b, "es"));

export async function canalesPendientes(): Promise<CanalPendiente[]> {
  const { data, error } = await createServiceClient().schema("ventas").rpc("canales_pendientes_homologar");
  if (error) throw new Error(`canales pendientes: ${error.message}`);
  return (data as CanalPendiente[]).map((f) => ({ ...f, venta_neta: Number(f.venta_neta), kg: Number(f.kg), filas: Number(f.filas) }));
}

export async function bitacoraHomologacion(limite = 30): Promise<CambioHomologacion[]> {
  const svc = createServiceClient();
  const { data, error } = await svc.schema("ventas").from("homologacion_cambio")
    .select("id, valor_origen, accion, antes, despues, cargas_actualizadas, usuario_id, creado_en")
    .eq("dimension", "canal").order("creado_en", { ascending: false }).limit(limite);
  if (error) throw new Error(`bitácora de homologación: ${error.message}`);
  const ids = [...new Set(data.map((f) => f.usuario_id).filter(Boolean))] as string[];
  const nombres = ids.length ? (await svc.from("perfil").select("user_id, nombre").in("user_id", ids)).data ?? [] : [];
  const nombre = new Map(nombres.map((p) => [p.user_id as string, p.nombre as string]));
  return data.map(({ usuario_id, ...f }) => ({ ...f, usuario: usuario_id ? nombre.get(usuario_id) ?? null : null }) as CambioHomologacion);
}

export const DatosHomologacion = z.object({
  origen: z.string().trim().max(100, "El canal de origen pasa de 100 caracteres."),
  canal: z.string().trim().min(1, "Elige o escribe el canal BIA.").max(60, "El canal BIA pasa de 60 caracteres."),
  nuevo: z.boolean(),
});

export type ResultadoHomologacion = { error?: string; accion?: string; cargas?: { archivo: string; filas: number }[] };

const mensaje = (e: { message: string }) => e.message.replace(/^.*?: /, "");

/** Crea o cambia una equivalencia. Un canal BIA que no existe todavía exige marcar "canal nuevo" (evita variantes). */
export async function guardarHomologacion(d: z.infer<typeof DatosHomologacion>, usuario: string): Promise<ResultadoHomologacion> {
  const existentes = canalesBia(await homologacionesCanal());
  const igual = existentes.find((c) => c.localeCompare(d.canal, "es", { sensitivity: "base" }) === 0);
  if (!igual && !d.nuevo) return { error: `«${d.canal}» no es un canal BIA en uso. Elige uno de la lista o marca que es un canal nuevo.` };
  const { data, error } = await createServiceClient().schema("ventas").rpc("guardar_homologacion_canal", {
    p_origen: d.origen, p_homologado: igual ?? d.canal, p_usuario: usuario,
  });
  if (error) return { error: mensaje(error) };
  const r = data as { accion: string; cargas_actualizadas: { archivo: string; filas: number }[] };
  return { accion: r.accion, cargas: r.cargas_actualizadas };
}

export async function eliminarHomologacion(origen: string, usuario: string): Promise<ResultadoHomologacion> {
  const { data, error } = await createServiceClient().schema("ventas").rpc("eliminar_homologacion_canal", { p_origen: origen, p_usuario: usuario });
  if (error) return { error: mensaje(error) };
  const r = data as { accion: string; cargas_actualizadas: { archivo: string; filas: number }[] };
  return { accion: r.accion, cargas: r.cargas_actualizadas };
}
