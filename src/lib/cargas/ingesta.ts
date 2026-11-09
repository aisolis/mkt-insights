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
/** Celda que no se entiende: la fila va a cuarentena (S29) con el dato y lo que traía la celda, nada más. */
class CeldaInvalida extends Error {
  constructor(readonly valor: string, readonly motivo: string) { super(`${motivo} «${valor}»`); }
}
const recorte = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
const num = (v: unknown) => {
  const x = sinFormula(v);
  const n = typeof x === "number" ? x : Number(txt(x).replace(/,/g, ""));
  if (Number.isNaN(n)) throw new CeldaInvalida(recorte(txt(x)), "valor numérico inválido");
  return n;
};
function fecha(v: unknown): { d: Date; serial: boolean } {
  const x = sinFormula(v);
  if (x instanceof Date) return { d: x, serial: false };
  const n = Number(x);
  if (txt(x) !== "" && !Number.isNaN(n)) return { d: new Date(Date.UTC(1899, 11, 30) + n * 86400000), serial: true }; // S9
  throw new CeldaInvalida(recorte(txt(x)), "fecha inválida");
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
  desde: string; hasta: string; hojasIgnoradas: string[]; columnas: ColumnasHoja[]; cuarentena: FilaCuarentena[];
};

/** Fila que no se cargó por una celda inválida (S29). */
export type FilaCuarentena = { hoja: string; fila: number; campo: Campo; valor: string; motivo: string };

/** Más de esto (y más del 1 % de las filas) no son celdas sueltas sino una exportación mal hecha: la carga falla. */
export const MAX_CUARENTENA = 20;

/** Lee el Excel e inserta las filas de las hojas con las columnas configuradas; las demás hojas se saltan y se
 * informan. Error con hoja y fila si una fila no cuadra, o si ninguna hoja tiene las columnas. */
export async function ingerirXlsx(svc: SupabaseClient, cargaId: string, entrada: string | Readable, avance?: (n: number) => void | Promise<void>,
  intento?: number): Promise<Conteo> {
  const [{ data: h, error: eh }, mapeo] = await Promise.all([
    svc.schema("ventas").from("homologacion").select("valor_origen, valor_homologado").eq("dimension", "canal"),
    leerMapeo(svc),
  ]);
  if (eh) throw new Error(`homologación: ${eh.message}`);
  const homol = new Map(h.map((r) => [r.valor_origen, r.valor_homologado]));
  const vistos = new Set<string>();
  const c: Conteo = { leidas: 0, vacias: 0, cargadas: 0, duplicados: 0, discrepancias: 0, seriales: 0, desde: "9999-12-31", hasta: "0000-01-01", hojasIgnoradas: [], columnas: [], cuarentena: [] };
  let lote: Record<string, unknown>[] = [];

  const vaciar = async () => {
    if (!lote.length) return;
    // Antes de insertar: si `avance` lanza (otro intento tomó la carga, S30), este lote no se escribe.
    await avance?.(c.cargadas + lote.length);
    if (intento !== undefined) {
      // Con intento (app): la base inserta solo si la carga sigue siendo de este intento, bajo bloqueo (S30).
      const { data, error } = await svc.schema("ventas").rpc("insertar_lote", { p_carga: cargaId, p_intento: intento, p_filas: lote });
      if (error) throw new Error(`insertar filas: ${error.message}`);
      if (data !== true) throw new CargaTomada();
    } else {
      const { error } = await svc.schema("ventas").from("hecho").insert(lote);
      if (error) throw new Error(`insertar filas: ${error.message}`);
    }
    c.cargadas += lote.length;
    lote = [];
  };

  const hojas = await recorrer(entrada, mapeo, async (hoja, numero, vals, l) => {
    c.leidas++;
    if (vals.every((x) => txt(x) === "")) { c.vacias++; return; }
    // Un campo opcional que el archivo no trae se carga vacío (texto) o nulo (fardos por caja).
    const v = (campo: Campo) => { const i = l.indices[campo]; return i === undefined ? undefined : vals[i]; };
    const t = (campo: Campo) => txt(v(campo));
    const cod = (campo: Campo) => codigo(v(campo));
    // Cada celda numérica o de fecha dice de qué dato es si falla.
    const de = <T,>(campo: Campo, leer: (x: unknown) => T): T => {
      try { return leer(v(campo)); } catch (e) { if (e instanceof CeldaInvalida) Object.assign(e, { campo }); throw e; }
    };
    try {
      const f = de("fecha", fecha);
      if (f.serial) c.seriales++;
      const d = iso(f.d);
      if (d < c.desde) c.desde = d;
      if (d > c.hasta) c.hasta = d;
      const bruta = de("venta_bruta", num), desc = de("descuentos", num), neta = de("venta_neta", num);
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
        cantidad: de("cantidad", num), venta_bruta: bruta, descuentos: desc, venta_neta: neta, kg: de("kg", num),
        fardos_caja: fardos == null || txt(fardos) === "" ? null : de("fardos_caja", num),
        subgrupo: t("subgrupo"), sucursal: t("sucursal"),
        flag_discrepancia: discrepancia, flag_fecha_serial: f.serial, flag_duplicado: false,
      };
      const clave = JSON.stringify([fila.fecha, fila.ruta, fila.empresa, fila.marca, fila.categoria, fila.proveedor, fila.cliente_codigo, fila.cliente_nombre, fila.zona, fila.documento, fila.grupo, fila.canal_origen, fila.art_codigo, fila.art_descrip, fila.cantidad, bruta, desc, neta, fila.kg, fila.fardos_caja, fila.subgrupo, fila.sucursal]);
      if (vistos.has(clave)) { fila.flag_duplicado = true; c.duplicados++; } else vistos.add(clave); // S3: se conserva y se marca
      lote.push(fila);
    } catch (e) {
      if (e instanceof CeldaInvalida) {
        const campo = (e as CeldaInvalida & { campo: Campo }).campo;
        c.cuarentena.push({ hoja, fila: numero, campo, valor: e.valor, motivo: `${CAMPOS[campo].etiqueta}: ${e.motivo}` });
        return;
      }
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
        descartadas: x.lectura.descartadas.map(({ campo, encabezado }) => ({ campo, encabezado })),
      });
    } else {
      c.hojasIgnoradas.push(x.hoja);
      c.columnas.push({ hoja: x.hoja, ignorada: x.motivo ?? "sin las columnas configuradas" });
    }
  }
  if (!hojas.some((x) => x.lectura?.valida)) {
    // El motivo de la hoja más cerca de cargarse (la de ventas con una columna renombrada), no el del primer resumen.
    const faltan = (x: HojaLeida) => (x.lectura ? x.lectura.faltan.length + x.lectura.repetidos.length : Infinity);
    const motivo = hojas.filter((x) => x.motivo).sort((a, b) => faltan(a) - faltan(b))[0]?.motivo;
    throw new Error(motivo
      ? `${motivo} Si la columna cambió de nombre, agrégalo en Cargas → Columnas del Excel y pulsa Reintentar.`
      : "El archivo no tiene hojas con datos de venta.");
  }
  const q = c.cuarentena;
  if (q.length > MAX_CUARENTENA && q.length > (c.cargadas + q.length) * 0.01) {
    const ej = q.slice(0, 3).map((x) => `hoja «${x.hoja}», fila ${x.fila}: ${x.motivo.toLowerCase()} «${x.valor}»`).join("; ");
    throw new Error(`${q.length.toLocaleString("es-HN")} filas tienen celdas que no se entienden (más del 1 %): revisa la exportación. Por ejemplo, ${ej}.`);
  }
  if (!c.cargadas) throw new Error(q.length ? `Ninguna fila se pudo cargar: ${q[0].motivo.toLowerCase()} «${q[0].valor}» en la hoja «${q[0].hoja}», fila ${q[0].fila}.` : "El archivo no tiene filas de venta.");
  return c;
}

/** Hojas del libro y cómo se leerían sus encabezados con la configuración de ahora, sin cargar nada (probador). */
export const probarXlsx = (entrada: string | Readable, m: MapeoCarga) => recorrer(entrada, m, null);
export type PruebaHoja = HojaLeida;


/** Otro intento tomó la carga (S30): este proceso para sin escribir más. */
export class CargaTomada extends Error {
  constructor() { super("Otro proceso tomó esta carga; este intento se detuvo."); }
}

/** Cierra la carga en la base (totales por mes, resumen, estado validada) con los conteos de la ingesta. `intento`:
 * solo si la carga sigue siendo de ese intento (sin él, el script del histórico, que crea su propia carga). */
export async function cerrarCarga(svc: SupabaseClient, cargaId: string, c: Conteo, intento?: number) {
  if (intento !== undefined) {
    if (!(await latir(svc, cargaId, intento, "calculando totales", c.cargadas))) throw new CargaTomada();
    // Todo el cierre en una transacción que comprueba el intento con la fila de la carga bloqueada.
    const { data, error } = await svc.schema("ventas").rpc("cerrar_carga_intento", {
      p_carga: cargaId, p_intento: intento, p_cuarentena: c.cuarentena,
      p_conteos: { filas_leidas: c.leidas, filas_vacias: c.vacias, filas_cargadas: c.cargadas, filas_duplicadas: c.duplicados,
        filas_discrepancia: c.discrepancias, fechas_serial: c.seriales, hojas_ignoradas: c.hojasIgnoradas, columnas: c.columnas },
    });
    if (error) throw new Error(`cerrar carga: ${error.message}`);
    if (data !== true) throw new CargaTomada();
    return;
  }
  const up = await svc.schema("ventas").from("carga").update({
    filas_leidas: c.leidas, filas_vacias: c.vacias, filas_cargadas: c.cargadas,
    filas_duplicadas: c.duplicados, filas_discrepancia: c.discrepancias, fechas_serial: c.seriales, hojas_ignoradas: c.hojasIgnoradas,
    columnas: c.columnas, filas_cuarentena: c.cuarentena.length,
  }).eq("id", cargaId);
  if (up.error) throw new Error(`carga: ${up.error.message}`);
  await svc.schema("ventas").from("fila_cuarentena").delete().eq("carga_id", cargaId);
  for (let i = 0; i < c.cuarentena.length; i += LOTE) {
    const { error } = await svc.schema("ventas").from("fila_cuarentena").insert(c.cuarentena.slice(i, i + LOTE).map((x) => ({ carga_id: cargaId, ...x })));
    if (error) throw new Error(`cuarentena: ${error.message}`);
  }
  const { error } = await svc.schema("ventas").rpc("cerrar_carga", { p_carga: cargaId });
  if (error) throw new Error(`cerrar carga: ${error.message}`);
}

/** Si algo falla, la carga queda con su error y sin filas a medias. Con `intento`, solo si la carga sigue siendo suya. */
export async function fallarCarga(svc: SupabaseClient, cargaId: string, error: string, intento?: number) {
  if (intento !== undefined) {
    const { data } = await svc.schema("ventas").rpc("fallar_carga_intento", { p_carga: cargaId, p_intento: intento, p_error: error });
    if (data !== true) console.info(`[cargas] ${cargaId}: el intento ${intento} ya no es el dueño; no se marca el error`);
    return;
  }
  await svc.schema("ventas").from("hecho").delete().eq("carga_id", cargaId);
  await svc.schema("ventas").from("fila_cuarentena").delete().eq("carga_id", cargaId);
  await svc.schema("ventas").from("carga").update({ estado: "con_errores", error, etapa: null, latido_en: null }).eq("id", cargaId);
}

async function latir(svc: SupabaseClient, cargaId: string, intento: number, etapa: string, avance?: number): Promise<boolean> {
  const { data, error } = await svc.schema("ventas").rpc("latir_carga", { p_carga: cargaId, p_intento: intento, p_etapa: etapa, p_avance: avance ?? null });
  if (error) throw new Error(`latido: ${error.message}`);
  return data === true;
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

/**
 * Toma la carga para procesarla (S30): devuelve el intento, o un error si no existe, ya terminó o hay un proceso vivo.
 * Un proceso que dejó de latir más de 2 minutos se puede retomar.
 */
export async function tomarCarga(svc: SupabaseClient, cargaId: string): Promise<{ intento: number } | { error: string }> {
  const carga = await svc.schema("ventas").from("carga").select("estado, ruta_archivo").eq("id", cargaId).maybeSingle();
  if (carga.error || !carga.data?.ruta_archivo) return { error: "No existe la carga." };
  const { data, error } = await svc.schema("ventas").rpc("tomar_carga", { p_carga: cargaId });
  if (error) return { error: `No se pudo iniciar el proceso (${error.message}).` };
  if (data == null) return { error: carga.data.estado === "procesando" ? "La carga ya se está procesando." : `La carga ya está ${carga.data.estado}.` };
  return { intento: data as number };
}

/** Procesa una carga de principio a fin, esperando el resultado (pruebas y scripts; la app usa tomarCarga + ejecutarCarga). */
export async function procesarCarga(svc: SupabaseClient, cargaId: string): Promise<ResultadoCarga> {
  const t = await tomarCarga(svc, cargaId);
  if ("error" in t) return { estado: "con_errores", error: t.error };
  return ejecutarCarga(svc, cargaId, t.intento);
}

/**
 * El trabajo de un intento: descarga de Storage, revisa duplicado por SHA-256, ingiere y cierra, dejando su etapa y su
 * avance en la carga. Si otro intento la toma entretanto, para sin tocar nada más.
 */
export async function ejecutarCarga(svc: SupabaseClient, cargaId: string, intento: number): Promise<ResultadoCarga> {
  const carga = await svc.schema("ventas").from("carga").select("id, ruta_archivo").eq("id", cargaId).single();
  const fallar = async (error: string): Promise<ResultadoCarga> => {
    await fallarCarga(svc, cargaId, error, intento);
    return { estado: "con_errores", error };
  };
  if (carga.error || !carga.data.ruta_archivo) return fallar("No existe la carga.");
  try {
    if (!(await latir(svc, cargaId, intento, "descargando el archivo"))) return { estado: "con_errores", error: new CargaTomada().message };
  } catch (e) {
    return fallar(e instanceof Error ? e.message : String(e));
  }

  const archivo = await svc.storage.from(BUCKET_CARGAS).download(carga.data.ruta_archivo);
  if (archivo.error) return fallar("No se encontró el archivo subido. Vuelve a subirlo.");
  const bytes = Buffer.from(await archivo.data.arrayBuffer());
  if (bytes.length > MAX_BYTES_CARGA) return fallar("El archivo pasa de 50 MB: para la exportación completa usa el script de ingesta.");
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") return fallar("El archivo no es un Excel (.xlsx).");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const otra = await svc.schema("ventas").from("carga").select("nombre_archivo, estado").eq("sha256", sha256).neq("id", cargaId).neq("estado", "con_errores").maybeSingle();
  if (otra.data) return fallar(`Este archivo ya se cargó («${otra.data.nombre_archivo}», ${otra.data.estado}).`);

  const marca = await svc.schema("ventas").from("carga").update({ sha256, bytes: bytes.length }).eq("id", cargaId).eq("intento", intento).select("id");
  if (marca.error) return fallar(`No se pudo marcar la carga (${marca.error.message}).`);
  if (!marca.data?.length) return { estado: "con_errores", error: new CargaTomada().message };
  try {
    // Reintento: sin restos del intento anterior; la base borra solo si la carga sigue siendo de este intento.
    const limpia = await svc.schema("ventas").rpc("limpiar_carga", { p_carga: cargaId, p_intento: intento });
    if (limpia.error) throw new Error(`limpiar carga: ${limpia.error.message}`);
    if (limpia.data !== true) throw new CargaTomada();
    if (!(await latir(svc, cargaId, intento, "leyendo filas", 0))) throw new CargaTomada();
    // Señal cada lote (~1000 filas) con el avance; si la carga ya es de otro intento, se corta antes del siguiente lote.
    const conteo = await ingerirXlsx(svc, cargaId, Readable.from(await ordenarXlsx(bytes)), async (n) => {
      if (!(await latir(svc, cargaId, intento, "leyendo filas", n))) throw new CargaTomada();
    }, intento);
    await cerrarCarga(svc, cargaId, conteo, intento);
    return { estado: "validada", conteo };
  } catch (e) {
    if (e instanceof CargaTomada) return { estado: "con_errores", error: e.message };
    return fallar(e instanceof Error ? e.message : String(e));
  }
}
