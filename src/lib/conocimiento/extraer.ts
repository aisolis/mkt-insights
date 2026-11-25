/**
 * Texto de un documento según su tipo, como lista de «páginas» (la unidad que cita el asistente):
 *   pdf  → una por página.
 *   xlsx → una por hoja; cada fila es una línea «Encabezado: valor | Encabezado: valor».
 *   docx, txt, md → una por sección: se corta en los títulos y, si una sección es muy larga, cada ~3,000 caracteres.
 * Sin dependencias del servidor: lo usan el proceso de documentos, los scripts y las pruebas.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import type { TipoDocumento } from "./tipos";

/** Tope del texto extraído de un documento que no es PDF (un zip pequeño puede expandirse muchísimo). */
const MAX_CARACTERES = 5_000_000;
const MAX_SECCION = 3000;
const MAX_HOJAS = 30;
const MAX_FILAS_HOJA = 20_000;

export class ErrorDocumento extends Error {}

const esZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Primera comprobación, barata, de que el archivo es del tipo que dice su extensión. Devuelve el error o null. */
export function firmaInvalida(bytes: Uint8Array, tipo: TipoDocumento): string | null {
  if (tipo === "pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-" ? null : "El archivo no es un PDF.";
  if (tipo === "docx") return esZip(bytes) ? null : "El archivo no es un Word (.docx) válido. Los .doc antiguos hay que guardarlos como .docx.";
  if (tipo === "xlsx") return esZip(bytes) ? null : "El archivo no es un Excel (.xlsx) válido. Los .xls antiguos hay que guardarlos como .xlsx.";
  return esZip(bytes) || new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-" || bytes.subarray(0, 8000).includes(0) ? "El archivo no es de texto." : null;
}

export async function extraerPaginas(bytes: Uint8Array, tipo: TipoDocumento = "pdf"): Promise<string[]> {
  if (tipo === "pdf") return paginasPdf(bytes);
  if (tipo === "docx") return secciones(await bloquesDocx(bytes));
  if (tipo === "xlsx") return hojasXlsx(bytes);
  return secciones(bloquesTexto(decodificar(bytes), tipo === "md"));
}

async function paginasPdf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

// Secciones (docx, txt, md) ------------------------------------------------------------------------------------------

type Bloque = { texto: string; titulo: boolean };

/** Agrupa los bloques en secciones: una nueva en cada título y, sin títulos, cuando la actual pasa de MAX_SECCION. */
export function secciones(bloques: Bloque[]): string[] {
  const salida: string[] = [];
  let actual: string[] = [], largo = 0;
  const cerrar = () => {
    if (actual.length) salida.push(actual.join("\n\n"));
    actual = []; largo = 0;
  };
  for (const b of bloques) {
    const texto = b.texto.trim();
    if (!texto) continue;
    // Un título abre sección solo si la actual ya tiene contenido además de su propio título.
    if (b.titulo && largo > 0) cerrar();
    else if (!b.titulo && largo + texto.length > MAX_SECCION && largo > 0) cerrar();
    actual.push(texto);
    if (!b.titulo) largo += texto.length;
  }
  cerrar();
  return salida;
}

function decodificar(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes); // texto guardado en Windows sin UTF-8
  }
}

/** Párrafos separados por línea en blanco; en Markdown, las líneas «# Título» abren sección. */
function bloquesTexto(texto: string, markdown: boolean): Bloque[] {
  if (texto.length > MAX_CARACTERES) throw new ErrorDocumento("El texto del archivo es demasiado largo.");
  const bloques: Bloque[] = [];
  for (const parrafo of texto.replace(/^﻿/, "").replace(/\r/g, "").split(/\n{2,}/)) {
    if (!markdown) { bloques.push({ texto: parrafo, titulo: false }); continue; }
    let pendiente: string[] = [];
    for (const linea of parrafo.split("\n")) {
      const t = /^#{1,6}\s+(.*)$/.exec(linea);
      if (!t) { pendiente.push(linea); continue; }
      if (pendiente.length) bloques.push({ texto: pendiente.join("\n"), titulo: false });
      pendiente = [];
      bloques.push({ texto: t[1].replace(/\s*#+\s*$/, ""), titulo: true });
    }
    if (pendiente.length) bloques.push({ texto: pendiente.join("\n"), titulo: false });
  }
  return bloques;
}

// Word ---------------------------------------------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const sinEntidades = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] !== "#") return ENTIDADES[e.toLowerCase()] ?? m;
  const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
});

/** Estilos de título de Word en español e inglés: «Heading1», «Ttulo1» (Título sin tilde en el id), «Title». */
const ES_TITULO = /^(heading|t[ií]?tulo|title|subt[ií]?tulo|subtitle)\s*\d*$/i;

/**
 * Párrafos de word/document.xml en orden. Las filas de una tabla salen como una línea «celda | celda». Se lee el
 * XML con expresiones regulares sobre las etiquetas que importan (párrafo, texto, salto, estilo, celda, fila): es
 * suficiente para extraer texto y evita cargar un analizador XML completo.
 */
export async function bloquesDocx(bytes: Uint8Array): Promise<Bloque[]> {
  let xml: string;
  try {
    const zip = await JSZip.loadAsync(bytes);
    const doc = zip.file("word/document.xml");
    if (!doc) throw new ErrorDocumento("El archivo no es un Word (.docx) válido.");
    xml = await doc.async("string");
  } catch (e) {
    if (e instanceof ErrorDocumento) throw e;
    throw new ErrorDocumento("No se pudo abrir el Word (.docx): el archivo está dañado o protegido con contraseña.");
  }
  if (xml.length > MAX_CARACTERES * 4) throw new ErrorDocumento("El documento de Word es demasiado grande.");

  const bloques: Bloque[] = [];
  let parrafo = "", titulo = false, enParrafo = false;
  let fila: string[] | null = null, celda: string[] = [];
  const etiquetas = /<w:(p|tbl|tr|tc)(?:\s[^>]*)?>|<\/w:(p|tr|tc)>|<w:pStyle\s[^>]*w:val="([^"]*)"[^>]*\/>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)(?:\s[^>]*)?\/>/g;
  for (let m = etiquetas.exec(xml); m; m = etiquetas.exec(xml)) {
    const [, abre, cierra, estilo, texto, salto] = m;
    if (abre === "p") { parrafo = ""; titulo = false; enParrafo = true; }
    else if (abre === "tr") fila = [];
    else if (abre === "tc") celda = [];
    else if (estilo !== undefined && enParrafo) titulo = ES_TITULO.test(estilo);
    else if (texto !== undefined && enParrafo) parrafo += sinEntidades(texto);
    else if (salto && enParrafo) parrafo += salto === "tab" ? "\t" : "\n";
    else if (cierra === "p") {
      enParrafo = false;
      if (fila) { if (parrafo.trim()) celda.push(parrafo.trim()); }
      else bloques.push({ texto: parrafo, titulo });
    } else if (cierra === "tc" && fila) fila.push(celda.join(" "));
    else if (cierra === "tr" && fila) {
      if (fila.some(Boolean)) bloques.push({ texto: fila.join(" | "), titulo: false });
      fila = null;
    }
  }
  return bloques;
}

// Excel --------------------------------------------------------------------------------------------------------------

/** Texto de una celda de ExcelJS: también texto con formato, hipervínculos y fórmulas (su resultado). */
function celdaTexto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 10_000) / 10_000);
  if (typeof v === "object") {
    const o = v as { text?: unknown; richText?: { text: string }[]; result?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((p) => p.text).join("").trim();
    if ("text" in o) return celdaTexto(o.text);
    if ("result" in o) return celdaTexto(o.result);
    return "";
  }
  return String(v).replace(/\s+/g, " ").trim();
}

/**
 * Una «página» por hoja. La primera fila con dos o más celdas se toma como encabezados y cada fila siguiente sale
 * como «Encabezado: valor | Encabezado: valor», para que un fragmento se entienda sin ver la tabla completa.
 */
async function hojasXlsx(bytes: Uint8Array): Promise<string[]> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new ErrorDocumento("No se pudo abrir el Excel (.xlsx): el archivo está dañado o protegido con contraseña.");
  }
  const paginas: string[] = [];
  let total = 0;
  for (const hoja of libro.worksheets.slice(0, MAX_HOJAS)) {
    const lineas: string[] = [];
    let encabezados: string[] | null = null, filas = 0;
    hoja.eachRow((fila) => {
      if (++filas > MAX_FILAS_HOJA) return;
      const valores = (fila.values as unknown[]).slice(1).map(celdaTexto);
      const llenas = valores.filter(Boolean).length;
      if (!llenas) return;
      if (!encabezados && llenas >= 2) { encabezados = valores; return; }
      const enc = encabezados;
      lineas.push(valores.map((v, i) => (v ? (enc?.[i] ? `${enc[i]}: ${v}` : v) : "")).filter(Boolean).join(" | "));
    });
    // Una hoja con solo la fila de encabezados igual tiene texto que buscar.
    if (!lineas.length && encabezados) lineas.push((encabezados as string[]).filter(Boolean).join(" | "));
    const texto = lineas.length ? `Hoja «${hoja.name}»\n${lineas.join("\n")}` : "";
    total += texto.length;
    if (total > MAX_CARACTERES) throw new ErrorDocumento("El Excel tiene demasiado texto para usarlo como documento de contexto.");
    paginas.push(texto); // se conserva la posición: la «página» de una cita es el número de hoja
  }
  return paginas;
}
