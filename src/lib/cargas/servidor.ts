import "server-only";
import { z } from "zod";
import { enviarCorreo } from "@/lib/correo";
import { kpiPeriodo, variacionPorDimension } from "@/lib/semantic/queries";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { alertasCarga } from "./alertas";
import { canalesParaAlertas, mesesParaAlertas } from "./composicion";
import { procesarCarga } from "./ingesta";
import { correoResumen, datosResumen, rutaResumen, type FuenteResumen, type VersionResumen } from "./resumen";
import { BUCKET_CARGAS, MAX_BYTES_CARGA, type Alerta, type FilaCarga, type Version } from "./tipos";

/** Historial de versiones con la sesión de la persona (cualquiera con acceso). */
export async function versiones(): Promise<Version[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("ventas").rpc("versiones");
  if (error) throw new Error(`versiones: ${error.message}`);
  return data as Version[];
}

/** Cabecera y periodos de una versión publicada (la vigente si n es nulo), con la sesión de la persona. */
export async function versionPublicada(n: number | null): Promise<VersionResumen | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("ventas").rpc("version_publicada", { p_version: n });
  if (error) throw new Error(`version_publicada: ${error.message}`);
  return data as VersionResumen | null;
}

/** El resumen ejecutivo con la sesión de la persona (página y correo al publicar). */
export const fuenteResumen: FuenteResumen = { version: versionPublicada, kpiPeriodo, variacionPorDimension };

export type EstadoCorreo = "enviado" | "desarrollo" | "error";

/**
 * Envía el resumen del último mes cerrado de la versión recién publicada a las personas con perfil activo.
 * Nunca hace fallar la publicación: si algo sale mal devuelve "error" y lo deja en el log.
 */
export async function enviarResumenPublicado(version: number, origen: string): Promise<EstadoCorreo> {
  try {
    const resumen = await datosResumen(fuenteResumen, { version: String(version) });
    if (!resumen) return "error";
    const { data, error } = await createServiceClient().schema("ventas").rpc("correos_equipo");
    if (error) throw new Error(`correos_equipo: ${error.message}`);
    const correo = correoResumen(resumen, `${origen}${rutaResumen(resumen)}`);
    const r = await enviarCorreo({ para: data as string[], ...correo });
    if (r.estado === "error") console.error(`[correo] resumen v${version}: ${r.error}`);
    return r.estado;
  } catch (e) {
    console.error(`[correo] resumen v${version}:`, e);
    return "error";
  }
}

// Gestión (service_role). La llaman server actions y route handlers que ya verificaron requerirGestorCargas(). -----

export async function listarCargas(): Promise<FilaCarga[]> {
  const { data, error } = await createServiceClient().schema("ventas").from("carga")
    .select("id, nombre_archivo, estado, error, bytes, periodo_desde, periodo_hasta, filas_cargadas, filas_duplicadas, filas_discrepancia, creado_en, subido_por")
    .order("creado_en", { ascending: false }).limit(30);
  if (error) throw new Error(`cargas: ${error.message}`);
  return data as FilaCarga[];
}

const hoyHN = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date());

export async function mesesDeCargas(cargaIds: string[]) {
  return (await mesesParaAlertas(createServiceClient(), cargaIds)).porCarga;
}

export async function alertasDe(cargaIds: string[]): Promise<Map<string, Alerta[]>> {
  const svc = createServiceClient();
  const [{ porCarga, vigente }, hojas, canales] = await Promise.all([
    mesesParaAlertas(svc, cargaIds),
    svc.schema("ventas").from("carga").select("id, hojas_ignoradas").in("id", cargaIds),
    canalesParaAlertas(svc, cargaIds),
  ]);
  const ignoradas = new Map((hojas.data ?? []).map((c) => [c.id as string, (c.hojas_ignoradas ?? []) as string[]]));
  return new Map(cargaIds.map((id) => [id, alertasCarga(porCarga.get(id) ?? [], vigente, hoyHN(), ignoradas.get(id), canales.get(id))]));
}

export const MetaCarga = z.object({
  nombre_archivo: z.string().trim().min(1).max(200).regex(/\.xlsx$/i, "Solo se aceptan archivos .xlsx."),
  bytes: z.number().int().positive().max(MAX_BYTES_CARGA, "El archivo pasa de 50 MB: para la exportación completa usa el script de ingesta."),
});

export type SubidaCarga = { id: string; ruta: string; token: string } | { error: string };

/** Registra la carga y da una URL firmada: el navegador sube el Excel directo a Storage. */
export async function prepararCarga(meta: z.infer<typeof MetaCarga>, subidoPor: string): Promise<SubidaCarga> {
  const svc = createServiceClient();
  const id = crypto.randomUUID();
  const ruta = `${new Date().toISOString().slice(0, 7)}/${id}.xlsx`;
  const ins = await svc.schema("ventas").from("carga").insert({ id, ...meta, estado: "recibida", ruta_archivo: ruta, subido_por: subidoPor });
  if (ins.error) return { error: `No se pudo registrar la carga (${ins.error.message}).` };
  const url = await svc.storage.from(BUCKET_CARGAS).createSignedUploadUrl(ruta);
  if (url.error) return { error: `No se pudo preparar la subida (${url.error.message}).` };
  return { id, ruta, token: url.data.token };
}

export const procesar = (id: string) => procesarCarga(createServiceClient(), id);

export async function publicar(id: string, notas: string | null, ultimoMesCerrado: boolean, revisoAlertas: boolean, usuario: string): Promise<{ error?: string; version?: number }> {
  const alertas = (await alertasDe([id])).get(id) ?? [];
  if (alertas.some((a) => a.nivel === "bloqueo")) return { error: "La carga tiene bloqueos: corrige el archivo y vuelve a subirlo." };
  if (alertas.some((a) => a.nivel === "revisar") && !revisoAlertas) return { error: "Confirma que revisaste las alertas antes de publicar." };
  const { data, error } = await createServiceClient().schema("ventas").rpc("publicar", { p_carga: id, p_notas: notas, p_usuario: usuario, p_ultimo_mes_cerrado: ultimoMesCerrado });
  if (error) return { error: `No se pudo publicar (${error.message}).` };
  return { version: (data as { version: number }).version };
}

export async function retirar(version: number, motivo: string, usuario: string): Promise<{ error?: string }> {
  const { error } = await createServiceClient().schema("ventas").rpc("retirar_version", { p_version: version, p_motivo: motivo, p_usuario: usuario });
  return error ? { error: error.message.replace(/^.*?: /, "") } : {};
}

export async function conciliar(version: number, nota: string, usuario: string): Promise<{ error?: string }> {
  const { error } = await createServiceClient().schema("ventas").rpc("marcar_conciliada", { p_version: version, p_nota: nota, p_usuario: usuario });
  return error ? { error: error.message } : {};
}

/** Descarta una carga que no se publicó: borra sus filas y el archivo. */
export async function descartar(id: string): Promise<{ error?: string }> {
  const svc = createServiceClient();
  const c = await svc.schema("ventas").from("carga").select("estado, ruta_archivo").eq("id", id).single();
  if (c.error) return { error: "No existe la carga." };
  if (["publicada", "retirada"].includes(c.data.estado)) return { error: "Una carga publicada no se descarta: retira la versión." };
  await svc.schema("ventas").from("hecho").delete().eq("carga_id", id);
  const r = await svc.schema("ventas").from("carga").delete().eq("id", id);
  if (r.error) return { error: `No se pudo descartar (${r.error.message}).` };
  if (c.data.ruta_archivo) await svc.storage.from(BUCKET_CARGAS).remove([c.data.ruta_archivo]);
  return {};
}
