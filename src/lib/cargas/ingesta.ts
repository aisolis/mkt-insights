/**
 * Ingesta del Excel del cubo → ventas.hecho (G2, G7, G10). La usan el script (archivo completo, desde disco) y la
 * app (archivo del mes, desde Storage). Lee en streaming (ExcelJS), normaliza y sube en lotes con un cliente
 * service_role. Las columnas se buscan por nombre según la configuración de la app (S26, columnas.ts): no importa
 * el orden ni cómo se escriban (mayúsculas, tildes, signos). Reglas (SUPUESTOS.md): S2 homologación, S3 flags sin
 * corregir, S9 serial Excel → fecha, códigos a texto. Un error deja la carga "con_errores" y borra lo que alcanzó a
 * insertar.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { CAMPOS, esCampo, hojaExcluida, leerEncabezados, motivoHoja, type Campo, type ColumnaCarga, type ColumnasHoja, type LecturaHoja, type MapeoCarga } from "./columnas";
import { BUCKET_CARGAS, MAX_BYTES_CARGA } from "./tipos";

const LOTE = 2000;

/** Texto de una celda: también hipervínculos ({text}), texto con formato ({richText}) y fórmulas ({result}). */
const txt = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; richText?: { text: string }[]; result?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((p) => p.text).join("").trim();
    if ("text" in o) return txt(o.text);
    if ("result" in o) return txt(o.result);
  }
  return String(v).trim();
};
const sinFormula = (v: unknown) => (v !== null && typeof v === "object" && !(v instanceof Date) && "result" in (v as object) ? (v as { result: unknown }).result : v);
const codigo = (v: unknown) => { const x = sinFormula(v); return typeof x === "number" ? String(Math.trunc(x)) : txt(x); };
const num = (v: unknown) => {
  const x = sinFormula(v);
  const n = typeof x === "number" ? x : Number(txt(x).replace(/,/g, ""));
  if (Number.isNaN(n)) throw new Error(`valor numérico inválido: ${txt(x)}`);
  return n;
};
function fecha(v: unknown): { d: Date; serial: boolean } {
  const x = sinFormula(v);
  if (x instanceof Date) return { d: x, serial: false };
  const n = Number(x);
  if (txt(x) !== "" && !Number.isNaN(n)) return { d: new Date(Date.UTC(1899, 11, 30) + n * 86400000), serial: true }; // S9
  throw new Error(`fecha inválida: ${txt(x)}`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** La configuración de columnas vigente (S26). Sin ella no se carga nada: mejor fallar que adivinar. */
export async function leerMapeo(svc: SupabaseClient): Promise<MapeoCarga> {
  const [cols, formato] = await Promise.all([
    svc.schema("ventas").from("columna_carga").select("campo, encabezados, obligatoria, puede_faltar").order("orden"),
    svc.schema("ventas").from("formato_carga").select("fila_encabezado, hojas_excluidas").single(),
  ]);
  if (cols.error) throw new Error(`columnas de la carga: ${cols.error.message}`);
  if (formato.error) throw new Error(`formato de la carga: ${formato.error.message}`);
  const columnas = (cols.data as ColumnaCarga[]).filter((c) => esCampo(c.campo));
  const faltan = (Object.keys(CAMPOS) as Campo[]).filter((k) => !columnas.some((c) => c.campo === k));
  if (faltan.length) throw new Error(`Falta configurar las columnas de: ${faltan.join(", ")}.`);
  return { columnas, filaEncabezado: formato.data.fila_encabezado, hojasExcluidas: formato.data.hojas_excluidas ?? [] };
}

type HojaLeida = { hoja: string; excluida: boolean; cabecera: string[] | null; lectura: LecturaHoja | null; motivo: string | null };

/**
 * Recorre el libro y entrega a `fila` cada fila de datos de las hojas que se cargan (con su lectura de encabezados).
 * Las hojas excluidas se saltan en silencio; las que no tienen las columnas obligatorias quedan con su motivo.
 * Lee el archivo completo aunque `fila` lance: cortar el lector de ExcelJS a mitad de camino a veces revienta con
 * un error interno que tapa el nuestro. Sin `fila` (probador) solo se leen los encabezados: cortar cada hoja ahí sí
 * es seguro (el lector descarta el resto de la hoja) y baja de ~7 s a < 1 s con un mes completo.
 */
async function recorrer(entrada: string | Readable, m: MapeoCarga,
  fila: ((hoja: string, numero: number, vals: unknown[], l: LecturaHoja) => Promise<void>) | null): Promise<HojaLeida[]> {
  // styles: "cache" para que las fechas lleguen como Date; sin eso todo llega como número y S9 marcaría todas.
  const libro = new ExcelJS.stream.xlsx.WorkbookReader(entrada, { entries: "emit", sharedStrings: "cache", styles: "cache", worksheets: "emit" });
  const hojas: HojaLeida[] = [];
  let falla: unknown = null;
  for await (const ws of libro) {
    // @ts-expect-error name existe en el reader de streaming
    const hoja: string = ws.name;
    const h: HojaLeida = { hoja, excluida: hojaExcluida(hoja, m), cabecera: null, lectura: null, motivo: null };
    hojas.push(h);
    for await (const row of ws) {
      if (!fila && (h.excluida || row.number > m.filaEncabezado)) break;
      if (h.excluida || falla || row.number < m.filaEncabezado) continue;
      const vals = (row.values as unknown[]).slice(1);
      if (row.number === m.filaEncabezado) {
        h.cabecera = Array.from({ length: vals.length }, (_, i) => txt(vals[i]));
        h.lectura = leerEncabezados(h.cabecera, m);
        if (!h.lectura.valida) h.motivo = motivoHoja(hoja, h.lectura, m, h.cabecera);
        if (!fila) break;
        continue;
      }
      if (!fila || !h.lectura?.valida) continue;
      try { await fila(hoja, row.number, vals, h.lectura); } catch (e) { falla = e; }
    }
    if (!h.excluida && !h.cabecera) h.motivo = `Hoja «${hoja}»: no tiene encabezados en la fila ${m.filaEncabezado}.`;
  }
  if (falla) throw falla;
  return hojas;
}

/** hojasIgnoradas: hojas del libro sin las columnas configuradas (resúmenes, tablas dinámicas); se avisan antes de
 * publicar. columnas: cómo se leyó cada hoja (queda en la carga). */
export type Conteo = {
  leidas: number; vacias: number; cargadas: number; duplicados: number; discrepancias: number; seriales: number;
  desde: string; hasta: string; hojasIgnoradas: string[]; columnas: ColumnasHoja[];
};

/** Lee el Excel e inserta las filas de las hojas con las columnas configuradas; las demás hojas se saltan y se
 * informan. Error con hoja y fila si una fila no cuadra, o si ninguna hoja tiene las columnas. */
export async function ingerirXlsx(svc: SupabaseClient, cargaId: string, entrada: string | Readable, avance?: (n: number) => void): Promise<Conteo> {
  const [{ data: h, error: eh }, mapeo] = await Promise.all([
    svc.schema("ventas").from("homologacion").select("valor_origen, valor_homologado").eq("dimension", "canal"),
    leerMapeo(svc),
  ]);
  if (eh) throw new Error(`homologación: ${eh.message}`);
  const homol = new Map(h.map((r) => [r.valor_origen, r.valor_homologado]));
  const vistos = new Set<string>();
  const c: Conteo = { leidas: 0, vacias: 0, cargadas: 0, duplicados: 0, discrepancias: 0, seriales: 0, desde: "9999-12-31", hasta: "0000-01-01", hojasIgnoradas: [], columnas: [] };
  let lote: Record<string, unknown>[] = [];

  const vaciar = async () => {
    if (!lote.length) return;
    const { error } = await svc.schema("ventas").from("hecho").insert(lote);
    if (error) throw new Error(`insertar filas: ${error.message}`);
    c.cargadas += lote.length;
    lote = [];
    avance?.(c.cargadas);
  };

  const hojas = await recorrer(entrada, mapeo, async (hoja, numero, vals, l) => {
    c.leidas++;
    if (vals.every((x) => txt(x) === "")) { c.vacias++; return; }
    // Un campo opcional que el archivo no trae se carga vacío (texto) o nulo (fardos por caja).
    const v = (campo: Campo) => { const i = l.indices[campo]; return i === undefined ? undefined : vals[i]; };
    const t = (campo: Campo) => txt(v(campo));
    const cod = (campo: Campo) => codigo(v(campo));
    try {
      const f = fecha(v("fecha"));
      if (f.serial) c.seriales++;
      const d = iso(f.d);
      if (d < c.desde) c.desde = d;
      if (d > c.hasta) c.hasta = d;
      const bruta = num(v("venta_bruta")), desc = num(v("descuentos")), neta = num(v("venta_neta"));
      const discrepancia = Math.abs(bruta - desc - neta) > 0.01;
      if (discrepancia) c.discrepancias++;
      const canalOrigen = t("canal_origen");
      const fardos = v("fardos_caja");
      const fila = {
        carga_id: cargaId, hoja, fila_origen: numero,
        fecha: d, anio: f.d.getUTCFullYear(), mes: f.d.getUTCMonth() + 1,
        ruta: cod("ruta"), empresa: t("empresa"), marca: t("marca"), categoria: t("categoria"), proveedor: t("proveedor"),
        cliente_codigo: cod("cliente_codigo"), cliente_nombre: t("cliente_nombre"), zona: t("zona"), documento: cod("documento"),
        grupo: t("grupo"), canal_origen: canalOrigen, canal: homol.get(canalOrigen) ?? canalOrigen,
        art_codigo: cod("art_codigo"), art_descrip: t("art_descrip"),
        cantidad: num(v("cantidad")), venta_bruta: bruta, descuentos: desc, venta_neta: neta, kg: num(v("kg")),
        fardos_caja: fardos == null || txt(fardos) === "" ? null : num(fardos),
        subgrupo: t("subgrupo"), sucursal: t("sucursal"),
        flag_discrepancia: discrepancia, flag_fecha_serial: f.serial, flag_duplicado: false,
      };
      const clave = JSON.stringify([fila.fecha, fila.ruta, fila.empresa, fila.marca, fila.categoria, fila.proveedor, fila.cliente_codigo, fila.cliente_nombre, fila.zona, fila.documento, fila.grupo, fila.canal_origen, fila.art_codigo, fila.art_descrip, fila.cantidad, bruta, desc, neta, fila.kg, fila.fardos_caja, fila.subgrupo, fila.sucursal]);
      if (vistos.has(clave)) { fila.flag_duplicado = true; c.duplicados++; } else vistos.add(clave); // S3: se conserva y se marca
      lote.push(fila);
    } catch (e) {
      throw new Error(`Hoja «${hoja}», fila ${numero}: ${e instanceof Error ? e.message : e}`);
    }
    if (lote.length >= LOTE) await vaciar();
  });
  await vaciar();

  for (const x of hojas) {
    if (x.excluida) continue;
    if (x.lectura?.valida) {
      c.columnas.push({
        hoja: x.hoja, campos: Object.fromEntries(x.lectura.encontrados.map((e) => [e.campo, e.encabezado])),
        faltan_opcionales: x.lectura.faltanOpcionales, sin_usar: x.lectura.sinUsar,
      });
    } else {
      c.hojasIgnoradas.push(x.hoja);
      c.columnas.push({ hoja: x.hoja, ignorada: x.motivo ?? "sin las columnas configuradas" });
    }
  }
  if (!hojas.some((x) => x.lectura?.valida)) {
    const motivo = hojas.find((x) => x.motivo)?.motivo;
    throw new Error(motivo
      ? `${motivo} Si la columna cambió de nombre, agrégalo en Cargas → Columnas del Excel y pulsa Reintentar.`
      : "El archivo no tiene hojas con datos de venta.");
  }
  if (!c.cargadas) throw new Error("El archivo no tiene filas de venta.");
  return c;
}

/** Hojas del libro y cómo se leerían sus encabezados con la configuración de ahora, sin cargar nada (probador). */
export const probarXlsx = (entrada: string | Readable, m: MapeoCarga) => recorrer(entrada, m, null);
export type PruebaHoja = HojaLeida;


/** Cierra la carga en la base (totales por mes, resumen, estado validada) con los conteos de la ingesta. */
export async function cerrarCarga(svc: SupabaseClient, cargaId: string, c: Conteo) {
  const up = await svc.schema("ventas").from("carga").update({
    filas_leidas: c.leidas, filas_vacias: c.vacias, filas_cargadas: c.cargadas,
    filas_duplicadas: c.duplicados, filas_discrepancia: c.discrepancias, fechas_serial: c.seriales, hojas_ignoradas: c.hojasIgnoradas,
    columnas: c.columnas,
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
