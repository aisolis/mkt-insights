import "server-only";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createServiceClient } from "@/lib/supabase/server";
import { leerControl, MAX_BYTES_CONTROL, MAX_FILAS_CONTROL, tablaCsv, type ControlBi, type LecturaControl } from "./control-bi";
import { MIME_XLSX } from "./tipos";

const BUCKET_CONTROLES = "controles-bi";

/** Último control de BI de cada carga, con la comparación de ahora (la carga pudo cambiar por homologación). */
export async function controlesDe(cargaIds: string[]): Promise<Map<string, ControlBi>> {
  if (!cargaIds.length) return new Map();
  const { data, error } = await createServiceClient().schema("ventas").rpc("controles", { p_cargas: cargaIds });
  if (error) throw new Error(`controles: ${error.message}`);
  return new Map((data as ControlBi[]).map((c) => [c.carga_id, c]));
}

/** Un control son unos KB; un .xlsx que se descomprime en más de esto (o con muchas partes) no es un reporte de BI. */
const MAX_XLSX_DESCOMPRIMIDO = 20 * 1024 * 1024;
const MAX_PARTES_XLSX = 200;
const MAX_FILA_CONTROL = MAX_FILAS_CONTROL + 50;

/** Antes de abrir el libro: tamaño descomprimido y número de partes, para no inflar un zip malicioso en memoria. */
async function xlsxRazonable(bytes: Buffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(bytes);
  const partes = Object.values(zip.files).filter((f) => !f.dir);
  const total = partes.reduce((s, f) => s + ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? Infinity), 0);
  return partes.length <= MAX_PARTES_XLSX && total <= MAX_XLSX_DESCOMPRIMIDO;
}

/** La primera hoja del libro con encabezados de control reconocibles. */
async function leerXlsx(bytes: Buffer): Promise<LecturaControl> {
  if (!(await xlsxRazonable(bytes))) return { error: "El Excel es demasiado grande para un control de BI: entrégalo por mes y canal, no por línea." };
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(bytes as unknown as ArrayBuffer);
  let primera: LecturaControl | null = null;
  for (const hoja of libro.worksheets.slice(0, 20)) {
    const tabla: unknown[][] = [];
    let larga = false;
    hoja.eachRow((fila, n) => {
      if (n > MAX_FILA_CONTROL) { larga = true; return; }
      tabla[n - 1] = (fila.values as unknown[]).slice(1, 50);
    });
    if (larga) return { error: `El control pasa de ${MAX_FILAS_CONTROL.toLocaleString("es-HN")} filas: entrégalo por mes y canal, no por línea.` };
    const l = leerControl(tabla.map((f) => f ?? []));
    if (!("error" in l)) return l;
    primera ??= l;
  }
  return primera ?? { error: "El libro no tiene hojas." };
}

export type DatosControl = { custodio: string; fecha_corte: string; nota: string | null; decimales_kg: number };

/**
 * Guarda el reporte de BI de una carga: el original en Storage (con su huella), sus filas y la comparación. Si la carga
 * ya está publicada en la versión vigente, intenta el sello «conciliada con BI» (solo si coincide y el mes es completo).
 */
export async function subirControl(cargaId: string, archivo: File, datos: DatosControl, usuario: string): Promise<{ error?: string; ok?: string }> {
  const ext = archivo.name.toLowerCase().match(/\.(xlsx|csv)$/)?.[1];
  if (!ext) return { error: "El control debe ser .xlsx o .csv." };
  if (archivo.size > MAX_BYTES_CONTROL) return { error: "El control pasa de 900 KB: BI debe entregarlo por mes y canal, no por línea." };
  const bytes = Buffer.from(await archivo.arrayBuffer());
  let lectura: LecturaControl;
  try {
    lectura = ext === "xlsx" ? await leerXlsx(bytes) : leerControl(tablaCsv(bytes.toString("utf8")).slice(0, MAX_FILA_CONTROL));
  } catch {
    return { error: "No se pudo leer el archivo. ¿Es un Excel o CSV válido?" };
  }
  if ("error" in lectura) return { error: lectura.error };

  const svc = createServiceClient();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ruta = `${cargaId}/${sha256}.${ext}`;
  const up = await svc.storage.from(BUCKET_CONTROLES).upload(ruta, bytes, { upsert: true, contentType: ext === "csv" ? "text/csv" : MIME_XLSX });
  if (up.error) return { error: `No se pudo guardar el archivo (${up.error.message}).` };
  const g = await svc.schema("ventas").rpc("guardar_control", {
    p_carga: cargaId, p_usuario: usuario, p_filas: lectura.filas,
    p_meta: { nombre_archivo: archivo.name, ruta_archivo: ruta, sha256, ...datos, nivel: lectura.nivel, medidas: lectura.medidas },
  });
  if (g.error) return { error: g.error.message.charAt(0).toUpperCase() + g.error.message.slice(1) + "." };

  const control = (await controlesDe([cargaId])).get(cargaId);
  const r = control?.resultado;
  const resumen = r?.coincide ? `Coincide: ${r.cifras.toLocaleString("es-HN")} cifras iguales.` : `No coincide: ${r?.total_diferencias ?? 0} cifras distintas.`;
  const pub = await svc.schema("ventas").from("publicacion").select("version").eq("carga_id", cargaId).is("retirada_en", null).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!pub.data) return { ok: `Control guardado. ${resumen}` };
  const s = await svc.schema("ventas").rpc("sellar_con_control", { p_version: pub.data.version });
  if (s.error) return { error: `Control guardado, pero no se pudo conciliar la v${pub.data.version} (${s.error.message}).` };
  const sello = s.data as { sellada: boolean; motivo: string | null };
  return { ok: sello.sellada ? `Control guardado. ${resumen} La v${pub.data.version} quedó conciliada con BI.` : `Control guardado. ${resumen} La v${pub.data.version} sigue sin conciliar: ${sello.motivo}.` };
}

/** Carga de donde salió una versión publicada (para subirle el control después de publicar). */
export async function cargaDeVersion(version: number): Promise<string | null> {
  const { data } = await createServiceClient().schema("ventas").from("publicacion").select("carga_id").eq("version", version).maybeSingle();
  return (data?.carga_id as string | undefined) ?? null;
}
