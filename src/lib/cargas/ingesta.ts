/**
 * Ingesta del Excel del cubo → ventas.hecho (G2, G7). La usan el script (archivo completo, desde disco) y la app
 * (archivo del mes, desde Storage). Lee en streaming (ExcelJS), normaliza y sube en lotes con un cliente
 * service_role. Reglas (SUPUESTOS.md): S2 homologación, S3 flags sin corregir, S9 serial Excel → fecha,
 * códigos a texto. Un error deja la carga "con_errores" y borra lo que alcanzó a insertar.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { BUCKET_CARGAS, MAX_BYTES_CARGA } from "./tipos";

export const COLS = ["Fecha", "Ruta", "Empresa", "Marca", "Café/Rep", "Proveedor", "Cliente Codigo", "Cliente Nombre", "Zona", "Documento", "Año", "Mes Nom", "Grupo", "Canal BIA", "ArtCodigo", "ArtDescrip", "Cantidad", "Venta Bruta", "Descuentos", "Venta Neta", "Kg", "Fardos/Caja", "Subgrupo", "Sucursal"] as const;
const LOTE = 2000;
const HOJAS_HECHOS = (nombre: string) => nombre !== "Desgloce";

const txt = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" && "text" in (v as object) ? String((v as { text: string }).text) : String(v)).trim();
const codigo = (v: unknown) => (typeof v === "number" ? String(Math.trunc(v)) : txt(v));
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(txt(v).replace(/,/g, ""));
  if (Number.isNaN(n)) throw new Error(`valor numérico inválido: ${txt(v)}`);
  return n;
};
function fecha(v: unknown): { d: Date; serial: boolean } {
  if (v instanceof Date) return { d: v, serial: false };
  const n = Number(v);
  if (txt(v) !== "" && !Number.isNaN(n)) return { d: new Date(Date.UTC(1899, 11, 30) + n * 86400000), serial: true }; // S9
  throw new Error(`fecha inválida: ${txt(v)}`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** hojasIgnoradas: hojas del libro sin el formato del cubo (resúmenes, tablas dinámicas); se avisan antes de publicar. */
export type Conteo = { leidas: number; vacias: number; cargadas: number; duplicados: number; discrepancias: number; seriales: number; desde: string; hasta: string; hojasIgnoradas: string[] };

/** Lee el Excel e inserta las filas de las hojas con el formato del cubo; las demás hojas se saltan y se informan.
 * Error con hoja y fila si una fila no cuadra, o si ninguna hoja tiene el formato. */
export async function ingerirXlsx(svc: SupabaseClient, cargaId: string, entrada: string | Readable, avance?: (n: number) => void): Promise<Conteo> {
  const { data: h, error: eh } = await svc.schema("ventas").from("homologacion").select("valor_origen, valor_homologado").eq("dimension", "canal");
  if (eh) throw new Error(`homologación: ${eh.message}`);
  const homol = new Map(h.map((r) => [r.valor_origen, r.valor_homologado]));
  const vistos = new Set<string>();
  const c: Conteo = { leidas: 0, vacias: 0, cargadas: 0, duplicados: 0, discrepancias: 0, seriales: 0, desde: "9999-12-31", hasta: "0000-01-01", hojasIgnoradas: [] };
  let lote: Record<string, unknown>[] = [];

  const vaciar = async () => {
    if (!lote.length) return;
    const { error } = await svc.schema("ventas").from("hecho").insert(lote);
    if (error) throw new Error(`insertar filas: ${error.message}`);
    c.cargadas += lote.length;
    lote = [];
    avance?.(c.cargadas);
  };

  // styles: "cache" para que las fechas lleguen como Date; sin eso todo llega como número y S9 marcaría todas.
  const libro = new ExcelJS.stream.xlsx.WorkbookReader(entrada, { entries: "emit", sharedStrings: "cache", styles: "cache", worksheets: "emit" });
  let hojas = 0;
  // Ante el primer error se deja de procesar pero se termina de leer el archivo: cortar el lector de ExcelJS a
  // mitad de camino a veces revienta con un error interno que tapa el nuestro.
  let falla: string | null = null;
  let primerFormato: string | null = null;
  for await (const ws of libro) {
    // @ts-expect-error name existe en el reader de streaming
    const hoja: string = ws.name;
    if (!HOJAS_HECHOS(hoja)) continue;
    let saltar = false;
    for await (const row of ws) {
      if (falla || saltar) continue;
      const vals = (row.values as unknown[]).slice(1);
      if (row.number === 1) {
        const cab = vals.map(txt);
        const i = COLS.findIndex((col, j) => cab[j] !== col);
        if (i >= 0) {
          saltar = true;
          c.hojasIgnoradas.push(hoja);
          primerFormato ??= `Hoja «${hoja}»: la columna ${i + 1} debería ser «${COLS[i]}» y es «${cab[i] ?? ""}». Exporta con el mismo formato del cubo.`;
        } else hojas++;
        continue;
      }
      c.leidas++;
      if (vals.every((v) => v === null || v === undefined || txt(v) === "")) { c.vacias++; continue; }
      try {
        const r = Object.fromEntries(COLS.map((col, i) => [col, vals[i]])) as Record<(typeof COLS)[number], unknown>;
        const f = fecha(r["Fecha"]);
        if (f.serial) c.seriales++;
        const d = iso(f.d);
        if (d < c.desde) c.desde = d;
        if (d > c.hasta) c.hasta = d;
        const bruta = num(r["Venta Bruta"]), desc = num(r["Descuentos"]), neta = num(r["Venta Neta"]);
        const discrepancia = Math.abs(bruta - desc - neta) > 0.01;
        if (discrepancia) c.discrepancias++;
        const canalOrigen = txt(r["Canal BIA"]);
        const fila = {
          carga_id: cargaId, hoja, fila_origen: row.number,
          fecha: d, anio: f.d.getUTCFullYear(), mes: f.d.getUTCMonth() + 1,
          ruta: codigo(r["Ruta"]), empresa: txt(r["Empresa"]), marca: txt(r["Marca"]), categoria: txt(r["Café/Rep"]), proveedor: txt(r["Proveedor"]),
          cliente_codigo: codigo(r["Cliente Codigo"]), cliente_nombre: txt(r["Cliente Nombre"]), zona: txt(r["Zona"]), documento: codigo(r["Documento"]),
          grupo: txt(r["Grupo"]), canal_origen: canalOrigen, canal: homol.get(canalOrigen) ?? canalOrigen,
          art_codigo: codigo(r["ArtCodigo"]), art_descrip: txt(r["ArtDescrip"]),
          cantidad: num(r["Cantidad"]), venta_bruta: bruta, descuentos: desc, venta_neta: neta, kg: num(r["Kg"]),
          fardos_caja: r["Fardos/Caja"] == null ? null : num(r["Fardos/Caja"]),
          subgrupo: txt(r["Subgrupo"]), sucursal: txt(r["Sucursal"]),
          flag_discrepancia: discrepancia, flag_fecha_serial: f.serial, flag_duplicado: false,
        };
        const clave = JSON.stringify([fila.fecha, fila.ruta, fila.empresa, fila.marca, fila.categoria, fila.proveedor, fila.cliente_codigo, fila.cliente_nombre, fila.zona, fila.documento, fila.grupo, fila.canal_origen, fila.art_codigo, fila.art_descrip, fila.cantidad, bruta, desc, neta, fila.kg, fila.fardos_caja, fila.subgrupo, fila.sucursal]);
        if (vistos.has(clave)) { fila.flag_duplicado = true; c.duplicados++; } else vistos.add(clave); // S3: se conserva y se marca
        lote.push(fila);
      } catch (e) {
        falla = `Hoja «${hoja}», fila ${row.number}: ${e instanceof Error ? e.message : e}`;
        continue;
      }
      if (lote.length >= LOTE) await vaciar();
    }
  }
  if (falla) throw new Error(falla);
  await vaciar();
  if (!hojas) throw new Error(primerFormato ?? "El archivo no tiene hojas con datos de venta.");
  if (!c.cargadas) throw new Error("El archivo no tiene filas de venta.");
  return c;
}

/** Cierra la carga en la base (totales por mes, resumen, estado validada) con los conteos de la ingesta. */
export async function cerrarCarga(svc: SupabaseClient, cargaId: string, c: Conteo) {
  const up = await svc.schema("ventas").from("carga").update({
    filas_leidas: c.leidas, filas_vacias: c.vacias, filas_cargadas: c.cargadas,
    filas_duplicadas: c.duplicados, filas_discrepancia: c.discrepancias, fechas_serial: c.seriales, hojas_ignoradas: c.hojasIgnoradas,
  }).eq("id", cargaId);
  if (up.error) throw new Error(`carga: ${up.error.message}`);
  const { error } = await svc.schema("ventas").rpc("cerrar_carga", { p_carga: cargaId });
  if (error) throw new Error(`cerrar carga: ${error.message}`);
}

/** Si algo falla, la carga queda con su error y sin filas a medias. */
export async function fallarCarga(svc: SupabaseClient, cargaId: string, error: string) {
  await svc.schema("ventas").from("hecho").delete().eq("carga_id", cargaId);
  await svc.schema("ventas").from("carga").update({ estado: "con_errores", error }).eq("id", cargaId);
}

/** El lector en streaming de ExcelJS necesita workbook.xml (y sus relaciones) antes que las hojas. Excel lo
 * escribe así, pero otras herramientas (incluido el propio ExcelJS) no siempre: se reordena el zip en memoria. */
const PRIMERO = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/sharedStrings.xml"];
export async function ordenarXlsx(bytes: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const nombres = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const orden = [...PRIMERO.filter((n) => nombres.includes(n)), ...nombres.filter((n) => !PRIMERO.includes(n))];
  const salida = new JSZip();
  for (const n of orden) salida.file(n, await zip.files[n].async("uint8array"));
  return salida.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export type ResultadoCarga = { estado: "validada"; conteo: Conteo } | { estado: "con_errores"; error: string };

/** Procesa una carga subida por la app: descarga de Storage, revisa duplicado por SHA-256, ingiere y cierra. */
export async function procesarCarga(svc: SupabaseClient, cargaId: string): Promise<ResultadoCarga> {
  const carga = await svc.schema("ventas").from("carga").select("id, estado, ruta_archivo").eq("id", cargaId).single();
  if (carga.error || !carga.data.ruta_archivo) return { estado: "con_errores", error: "No existe la carga." };
  if (!["recibida", "con_errores"].includes(carga.data.estado)) return { estado: "con_errores", error: `La carga ya está ${carga.data.estado}.` };
  const fallar = async (error: string): Promise<ResultadoCarga> => {
    await fallarCarga(svc, cargaId, error);
    return { estado: "con_errores", error };
  };

  const archivo = await svc.storage.from(BUCKET_CARGAS).download(carga.data.ruta_archivo);
  if (archivo.error) return fallar("No se encontró el archivo subido. Vuelve a subirlo.");
  const bytes = Buffer.from(await archivo.data.arrayBuffer());
  if (bytes.length > MAX_BYTES_CARGA) return fallar("El archivo pasa de 50 MB: para la exportación completa usa el script de ingesta.");
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") return fallar("El archivo no es un Excel (.xlsx).");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const otra = await svc.schema("ventas").from("carga").select("nombre_archivo, estado").eq("sha256", sha256).neq("id", cargaId).neq("estado", "con_errores").maybeSingle();
  if (otra.data) return fallar(`Este archivo ya se cargó («${otra.data.nombre_archivo}», ${otra.data.estado}).`);

  const marca = await svc.schema("ventas").from("carga").update({ estado: "procesando", error: null, sha256, bytes: bytes.length }).eq("id", cargaId);
  if (marca.error) return fallar(`No se pudo marcar la carga (${marca.error.message}).`);
  await svc.schema("ventas").from("hecho").delete().eq("carga_id", cargaId); // reintento: sin restos del intento anterior
  try {
    const conteo = await ingerirXlsx(svc, cargaId, Readable.from(await ordenarXlsx(bytes)));
    await cerrarCarga(svc, cargaId, conteo);
    return { estado: "validada", conteo };
  } catch (e) {
    return fallar(e instanceof Error ? e.message : String(e));
  }
}
