import "server-only";
import { Readable } from "node:stream";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { CAMPOS, esCampo, normalizarEncabezado, type ColumnasHoja, type MapeoCarga } from "./columnas";
import { leerMapeo, ordenarXlsx, probarXlsx, type PruebaHoja } from "./ingesta";
import { BUCKET_CARGAS, MAX_BYTES_CARGA } from "./tipos";

/**
 * Columnas del Excel desde la app (G10, S26). Service_role: lo llaman la página y las server actions que ya
 * verificaron requerirGestorCargas(). Los cambios van por funciones SQL que dejan la bitácora (0019).
 */

export type ConfigColumnas = MapeoCarga & { actualizadaEn: string | null };

export async function configColumnas(): Promise<ConfigColumnas> {
  const svc = createServiceClient();
  const [mapeo, f] = await Promise.all([leerMapeo(svc), svc.schema("ventas").from("formato_carga").select("actualizada_en").single()]);
  return { ...mapeo, actualizadaEn: f.data?.actualizada_en ?? null };
}

export type CambioColumnas = {
  id: number; tipo: "columna" | "formato"; campo: string | null;
  antes: { encabezados?: string[]; obligatoria?: boolean; fila_encabezado?: number; hojas_excluidas?: string[] } | null;
  despues: { encabezados?: string[]; obligatoria?: boolean; fila_encabezado?: number; hojas_excluidas?: string[] } | null;
  usuario: string | null; creado_en: string;
};

export async function bitacoraColumnas(limite = 20): Promise<CambioColumnas[]> {
  const svc = createServiceClient();
  const { data, error } = await svc.schema("ventas").from("columna_carga_cambio")
    .select("id, tipo, campo, antes, despues, usuario_id, creado_en").order("creado_en", { ascending: false }).limit(limite);
  if (error) throw new Error(`bitácora de columnas: ${error.message}`);
  const ids = [...new Set(data.map((f) => f.usuario_id).filter(Boolean))] as string[];
  const nombres = ids.length ? (await svc.from("perfil").select("user_id, nombre").in("user_id", ids)).data ?? [] : [];
  const nombre = new Map(nombres.map((p) => [p.user_id as string, p.nombre as string]));
  return data.map(({ usuario_id, ...f }) => ({ ...f, usuario: usuario_id ? nombre.get(usuario_id) ?? null : null }) as CambioColumnas);
}

/** Un nombre por línea (también acepta «;»): así un nombre puede llevar comas o barras ("Café/Rep"). */
export const separarLineas = (t: string) => t.split(/[\r\n;]+/).map((x) => x.trim()).filter(Boolean);

export const DatosColumna = z.object({
  campo: z.string().refine(esCampo, "Ese campo no existe."),
  encabezados: z.array(z.string().max(100, "Un nombre pasa de 100 caracteres.")).min(1, "Indica al menos un nombre de columna.").max(20, "Son más de 20 nombres."),
  obligatoria: z.boolean(),
});

export const DatosFormato = z.object({
  fila: z.coerce.number({ message: "La fila debe ser un número." }).int("La fila debe ser un número entero.").min(1, "La fila va de 1 a 50.").max(50, "La fila va de 1 a 50."),
  hojas: z.array(z.string().max(100, "Un nombre de hoja pasa de 100 caracteres.")).max(30, "Son más de 30 hojas."),
});

const mensaje = (e: { message: string }) => e.message.replace(/^.*?: /, "");

/** Revisa en el servidor lo mismo que la base (nombres repetidos entre campos) para dar el mensaje antes. */
export async function guardarColumna(d: z.infer<typeof DatosColumna>, usuario: string): Promise<{ error?: string; accion?: string }> {
  const actual = await configColumnas();
  const propios = new Set(d.encabezados.map(normalizarEncabezado).filter(Boolean));
  for (const c of actual.columnas) {
    if (c.campo === d.campo) continue;
    const choque = c.encabezados.find((e) => propios.has(normalizarEncabezado(e)));
    if (choque) return { error: `El nombre «${choque}» ya se usa para «${CAMPOS[c.campo].etiqueta}»: un nombre solo puede llenar un dato.` };
  }
  const { data, error } = await createServiceClient().schema("ventas").rpc("guardar_columna_carga", {
    p_campo: d.campo, p_encabezados: d.encabezados, p_obligatoria: d.obligatoria, p_usuario: usuario,
  });
  if (error) return { error: mensaje(error) };
  return { accion: (data as { accion: string }).accion };
}

export async function guardarFormato(d: z.infer<typeof DatosFormato>, usuario: string): Promise<{ error?: string; accion?: string }> {
  const { data, error } = await createServiceClient().schema("ventas").rpc("guardar_formato_carga", { p_fila: d.fila, p_hojas: d.hojas, p_usuario: usuario });
  if (error) return { error: mensaje(error) };
  return { accion: (data as { accion: string }).accion };
}

export type CargaParaProbar = { id: string; nombre_archivo: string; estado: string; creado_en: string; columnas: ColumnasHoja[] | null };

/** Cargas recientes con su archivo todavía en Storage (las descartadas ya no lo tienen). */
export async function cargasParaProbar(): Promise<CargaParaProbar[]> {
  const { data, error } = await createServiceClient().schema("ventas").from("carga")
    .select("id, nombre_archivo, estado, creado_en, columnas").not("ruta_archivo", "is", null)
    .order("creado_en", { ascending: false }).limit(15);
  if (error) throw new Error(`cargas: ${error.message}`);
  return data as CargaParaProbar[];
}

export type Prueba = { carga: CargaParaProbar; hojas: PruebaHoja[] } | { error: string };

/** Lee los encabezados del archivo de una carga con la configuración de ahora. No carga ni cambia nada. */
export async function probarCarga(id: string): Promise<Prueba> {
  const svc = createServiceClient();
  const c = await svc.schema("ventas").from("carga").select("id, nombre_archivo, estado, creado_en, columnas, ruta_archivo").eq("id", id).maybeSingle();
  if (c.error || !c.data) return { error: "No existe la carga." };
  if (!c.data.ruta_archivo) return { error: "Esa carga no tiene archivo (se cargó por script)." };
  const archivo = await svc.storage.from(BUCKET_CARGAS).download(c.data.ruta_archivo);
  if (archivo.error) return { error: "El archivo de esa carga ya no está." };
  const bytes = Buffer.from(await archivo.data.arrayBuffer());
  if (bytes.length > MAX_BYTES_CARGA || bytes.subarray(0, 2).toString("latin1") !== "PK") return { error: "El archivo no es un Excel (.xlsx) que se pueda leer." };
  try {
    const hojas = await probarXlsx(Readable.from(await ordenarXlsx(bytes)), await leerMapeo(svc));
    const { id: cid, nombre_archivo, estado, creado_en, columnas } = c.data;
    return { carga: { id: cid, nombre_archivo, estado, creado_en, columnas: columnas as ColumnasHoja[] | null }, hojas };
  } catch (e) {
    return { error: `No se pudo leer el archivo (${e instanceof Error ? e.message : e}).` };
  }
}
