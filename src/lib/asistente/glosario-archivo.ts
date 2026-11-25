/**
 * Lee un glosario desde un archivo Excel (.xlsx) o CSV: una fila por término, con encabezados «Término»,
 * «Definición» y, opcional, «Sinónimos» (separados por coma o punto y coma). Devuelve las filas válidas y, por
 * separado, las que no se pueden cargar con su número de fila, para que la persona las corrija.
 * Sin dependencias del servidor: lo usan la server action y las pruebas.
 */
import ExcelJS from "exceljs";
import { EntradaTermino, partirSinonimos, type TerminoValido } from "./glosario";
import { normalizar } from "./texto";

export const MAX_BYTES_GLOSARIO = 700 * 1024; // el cuerpo de una server action admite 1 MB
export const MAX_FILAS_GLOSARIO = 2000;

export type GlosarioLeido = { filas: TerminoValido[]; errores: string[]; error?: undefined } | { error: string };

const COLUMNAS = {
  termino: ["termino", "terminos", "concepto", "palabra", "nombre"],
  definicion: ["definicion", "significado", "descripcion", "que significa"],
  sinonimos: ["sinonimos", "sinonimo", "alias", "tambien conocido como", "tambien"],
} as const;

/** Texto de una celda de ExcelJS: también texto con formato, hipervínculos y fórmulas. */
function celda(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; richText?: { text: string }[]; result?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((p) => p.text).join("").trim();
    if ("text" in o) return celda(o.text);
    if ("result" in o) return celda(o.result);
    return "";
  }
  return String(v).trim();
}

async function tablaXlsx(bytes: Uint8Array): Promise<string[][]> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(bytes as unknown as ArrayBuffer);
  const hoja = libro.worksheets[0];
  if (!hoja) return [];
  const tabla: string[][] = [];
  hoja.eachRow({ includeEmpty: true }, (fila) => {
    if (tabla.length > MAX_FILAS_GLOSARIO + 20) return;
    const valores = fila.values as unknown[]; // ExcelJS numera las columnas desde 1
    tabla.push(Array.from({ length: Math.max(0, valores.length - 1) }, (_, i) => celda(valores[i + 1])));
  });
  return tabla;
}

/** CSV con comillas dobles; el separador (coma, punto y coma o tabulador) se deduce de la primera línea. */
export function tablaCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, "");
  const primera = limpio.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => ({ s, n: primera.split(s).length })).sort((a, b) => b.n - a.n)[0].s;
  const tabla: string[][] = [];
  let fila: string[] = [], campo = "", comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"' && campo === "") comillas = true;
    else if (c === sep) { fila.push(campo.trim()); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(campo.trim()); campo = "";
      tabla.push(fila); fila = [];
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo.trim()); tabla.push(fila); }
  return tabla;
}

function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes); // CSV guardado desde Excel en Windows
  }
}

/** Convierte la tabla en términos. La fila de encabezados es la primera que nombra «término» y «definición». */
export function glosarioDeTabla(tabla: string[][]): GlosarioLeido {
  const indice = (fila: string[], nombres: readonly string[]) => fila.findIndex((c) => nombres.includes(normalizar(c).replace(/[^a-z ]/g, "").trim()));
  const nEnc = tabla.slice(0, 15).findIndex((f) => indice(f, COLUMNAS.termino) >= 0 && indice(f, COLUMNAS.definicion) >= 0);
  if (nEnc < 0) return { error: "No encontré los encabezados. La primera fila debe tener las columnas «Término» y «Definición» (y, si quieres, «Sinónimos»)." };
  const enc = tabla[nEnc];
  const iT = indice(enc, COLUMNAS.termino), iD = indice(enc, COLUMNAS.definicion), iS = indice(enc, COLUMNAS.sinonimos);

  const filas: TerminoValido[] = [], errores: string[] = [];
  for (let n = nEnc + 1; n < tabla.length; n++) {
    const f = tabla[n];
    const termino = f[iT] ?? "", definicion = f[iD] ?? "", sinonimos = iS >= 0 ? f[iS] ?? "" : "";
    if (!termino && !definicion && !sinonimos) continue; // fila vacía
    if (filas.length >= MAX_FILAS_GLOSARIO) return { error: `El archivo tiene más de ${MAX_FILAS_GLOSARIO} términos. Divídelo en varios.` };
    const r = EntradaTermino.safeParse({ termino, definicion, sinonimos: partirSinonimos(sinonimos) });
    if (r.success) filas.push(r.data);
    else errores.push(`Fila ${n + 1}${termino ? ` («${termino.slice(0, 40)}»)` : ""}: ${r.error.issues[0].message}`);
  }
  if (!filas.length && !errores.length) return { error: "El archivo no tiene términos debajo de los encabezados." };
  return { filas, errores };
}

export async function leerGlosario(bytes: Uint8Array, nombre: string): Promise<GlosarioLeido> {
  if (bytes.length > MAX_BYTES_GLOSARIO) return { error: "El archivo pasa de 700 KB. Un glosario en Excel o CSV pesa mucho menos: revisa que sea el archivo correcto." };
  const esZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/\.xlsx$/i.test(nombre)) {
    if (!esZip) return { error: "El archivo no es un Excel (.xlsx) válido." };
    try {
      return glosarioDeTabla(await tablaXlsx(bytes));
    } catch (e) {
      return { error: `No se pudo leer el Excel (${e instanceof Error ? e.message : e}).` };
    }
  }
  if (/\.(csv|txt)$/i.test(nombre)) {
    if (esZip || bytes.includes(0)) return { error: "El archivo no es un CSV de texto." };
    return glosarioDeTabla(tablaCsv(decodificar(bytes)));
  }
  return { error: "Sube el glosario como Excel (.xlsx) o CSV." };
}
