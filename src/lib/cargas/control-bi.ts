/**
 * Control independiente de BI (V1-06, S28): leer el reporte que entrega BI y describir la comparación con la carga. Sin
 * dependencias de servidor (se prueba solo). La comparación la hace la base (ventas.comparar_control).
 */
import { normalizarEncabezado } from "./columnas";
import type { Alerta } from "./tipos";

export type Dimension = "empresa" | "canal";
export type Medida = "venta_neta" | "kg";
export type FilaControl = { anio: number; mes: number; empresa: string | null; canal: string | null; venta_neta: number | null; kg: number | null };
export type LecturaControl = { filas: FilaControl[]; nivel: Dimension[]; medidas: Medida[] } | { error: string };

export const MAX_FILAS_CONTROL = 5000;
/** Las server actions aceptan hasta 1 MB por pedido; un control por mes, empresa y canal pesa unos pocos KB. */
export const MAX_BYTES_CONTROL = 900 * 1024;

/** Nombres de columna que se aceptan (ya normalizados: sin tildes, minúsculas, signos como espacios). */
const ALIAS: Record<"anio" | "mes" | Dimension | Medida, string[]> = {
  anio: ["ano", "anio", "year"],
  mes: ["mes", "mes nom", "mes num", "mes numero", "month"],
  empresa: ["empresa"],
  canal: ["canal", "canal bia"],
  venta_neta: ["venta neta", "ventas netas", "venta neta l", "venta neta lps", "venta neta hnl"],
  kg: ["kg", "kilos", "kilogramos", "kg netos"],
};
export const ENCABEZADOS_CONTROL = "Año · Mes · Empresa (opcional) · Canal (opcional) · Venta Neta y/o Kg";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const texto = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; richText?: { text: string }[]; result?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((p) => p.text).join("").trim();
    if ("text" in o) return texto(o.text);
    if ("result" in o) return texto(o.result);
  }
  return String(v).trim();
};
const valor = (v: unknown) => (v !== null && typeof v === "object" && !(v instanceof Date) && "result" in (v as object) ? (v as { result: unknown }).result : v);

/** Número con punto decimal y, si quiere, comas de miles o paréntesis para negativos. "1.234,56" se rechaza: no se adivina. */
export function numeroControl(v: unknown): number | null {
  const x = valor(v);
  if (typeof x === "number") return Number.isFinite(x) ? x : NaN;
  let s = texto(x).replace(/[\s ]/g, "").replace(/^L\.?/i, "");
  if (!s || s === "-") return null;
  let signo = 1;
  if (/^\(.*\)$/.test(s)) { signo = -1; s = s.slice(1, -1); }
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? signo * Number(s) : NaN;
}

function mesDe(v: unknown): number | null {
  const x = valor(v);
  if (typeof x === "number") return Number.isInteger(x) && x >= 1 && x <= 12 ? x : null;
  const s = normalizarEncabezado(texto(x));
  if (/^\d{1,2}$/.test(s)) { const n = Number(s); return n >= 1 && n <= 12 ? n : null; }
  const i = MESES.findIndex((m) => m === s || (s.length >= 3 && m.startsWith(s)));
  return i >= 0 ? i + 1 : null;
}

/**
 * Lee la tabla del reporte de BI (filas de celdas, la primera hoja con encabezados reconocibles). Busca la fila de
 * encabezados en las primeras 20; ignora filas vacías y de total («Total», «Gran total»); cualquier otra celda que no se
 * entiende es un error con su fila, sin corregir nada.
 */
export function leerControl(tabla: unknown[][]): LecturaControl {
  const campos = Object.keys(ALIAS) as (keyof typeof ALIAS)[];
  let cab = -1;
  let idx: Partial<Record<keyof typeof ALIAS, number>> = {};
  for (let r = 0; r < Math.min(tabla.length, 20) && cab < 0; r++) {
    const nombres = (tabla[r] ?? []).map((c) => normalizarEncabezado(texto(c)));
    const encontrados: typeof idx = {};
    for (const campo of campos) {
      const i = nombres.findIndex((n) => ALIAS[campo].includes(n));
      if (i >= 0) encontrados[campo] = i;
    }
    if (encontrados.anio !== undefined && encontrados.mes !== undefined) { cab = r; idx = encontrados; }
  }
  if (cab < 0) return { error: `No se encontraron las columnas del control. Se esperan: ${ENCABEZADOS_CONTROL}.` };
  const medidas = (["venta_neta", "kg"] as const).filter((m) => idx[m] !== undefined);
  if (!medidas.length) return { error: "El control necesita una columna «Venta Neta» o «Kg»." };
  const nivel = (["empresa", "canal"] as const).filter((d) => idx[d] !== undefined);

  const filas: FilaControl[] = [];
  const claves = new Set<string>();
  for (let r = cab + 1; r < tabla.length; r++) {
    const fila = tabla[r] ?? [];
    const celda = (c: keyof typeof ALIAS) => (idx[c] === undefined ? undefined : fila[idx[c]!]);
    if (fila.every((c) => texto(c) === "")) continue;
    if (fila.some((c) => /^(gran )?total/i.test(texto(c)))) continue;
    const n = r + 1;
    const anioTxt = texto(valor(celda("anio")));
    const anio = Number(anioTxt);
    if (!/^\d{4}$/.test(anioTxt) || anio < 2000 || anio > 2100) return { error: `Fila ${n}: año inválido «${anioTxt}».` };
    const mes = mesDe(celda("mes"));
    if (!mes) return { error: `Fila ${n}: mes inválido «${texto(valor(celda("mes")))}» (número 1–12 o nombre del mes).` };
    const dim = (d: Dimension) => {
      if (!nivel.includes(d)) return null;
      const t = texto(valor(celda(d)));
      return t || "";
    };
    const empresa = dim("empresa"), canal = dim("canal");
    if (empresa === "") return { error: `Fila ${n}: falta la empresa.` };
    if (canal === "") return { error: `Fila ${n}: falta el canal.` };
    const medida = (m: Medida) => {
      if (!medidas.includes(m)) return null;
      return numeroControl(celda(m));
    };
    const venta = medida("venta_neta"), kg = medida("kg");
    for (const [m, x] of [["venta neta", venta], ["kg", kg]] as const) {
      if (Number.isNaN(x)) return { error: `Fila ${n}: ${m} no es un número (usa punto decimal, p. ej. 1234.56).` };
    }
    if (venta === null && kg === null) return { error: `Fila ${n}: no trae cifras.` };
    const clave = [anio, mes, normalizarEncabezado(empresa ?? ""), normalizarEncabezado(canal ?? "")].join("|");
    if (claves.has(clave)) return { error: `Fila ${n}: ${[MESES[mes - 1], anio, empresa, canal].filter(Boolean).join(" ")} aparece dos veces; el control debe traer una sola fila por clave.` };
    claves.add(clave);
    filas.push({ anio, mes, empresa, canal, venta_neta: venta, kg });
    if (filas.length > MAX_FILAS_CONTROL) return { error: `El control pasa de ${MAX_FILAS_CONTROL.toLocaleString("es-HN")} filas: entrégalo por mes y canal, no por línea.` };
  }
  if (!filas.length) return { error: "El control no trae filas con cifras." };
  return { filas, nivel, medidas };
}

/** CSV simple (coma o punto y coma, comillas dobles). */
export function tablaCsv(contenido: string): string[][] {
  const lineas = contenido.replace(/^﻿/, "").split(/\r?\n/);
  const sep = (lineas[0]?.split(";").length ?? 0) > (lineas[0]?.split(",").length ?? 0) ? ";" : ",";
  return lineas.map((l) => {
    const celdas: string[] = [];
    let actual = "", comillas = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (comillas) {
        if (ch === '"' && l[i + 1] === '"') { actual += '"'; i++; } else if (ch === '"') comillas = false; else actual += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { celdas.push(actual); actual = ""; } else actual += ch;
    }
    celdas.push(actual);
    return celdas;
  });
}

export type ResultadoControl = {
  cifras: number; iguales: number; coincide: boolean; total_diferencias: number;
  meses: { anio: number; mes: number; en_foresight: boolean; en_bi: boolean }[];
  diferencias: { anio: number; mes: number; empresa: string | null; canal: string | null; venta_foresight: number; venta_bi: number; kg_foresight: number; kg_bi: number }[];
};
export type ControlBi = {
  id: number; carga_id: string; nombre_archivo: string; custodio: string; fecha_corte: string; nota: string | null;
  nivel: Dimension[]; medidas: Medida[]; decimales_venta: number; decimales_kg: number; filas: number; subido_por: string | null;
  creado_en: string; resultado: ResultadoControl;
};

const mesTxt = (m: { anio: number; mes: number }) => `${MESES[m.mes - 1]} ${m.anio}`;

/** Meses que solo están de un lado: «el control no trae octubre 2026», «el control trae septiembre 2026 y la carga no». */
export function mesesSinCubrir(r: ResultadoControl): string[] {
  return r.meses.filter((m) => !m.en_bi || !m.en_foresight)
    .map((m) => (m.en_bi ? `el control trae ${mesTxt(m)} y la carga no` : `el control no trae ${mesTxt(m)}`));
}

/** La alerta de la carga según su control (entra en la aprobación como cualquier otra). */
export function alertaControl(c: ControlBi | undefined): Alerta {
  if (!c) return { nivel: "revisar", texto: "Sin control de BI: si se publica así, la versión queda «sin conciliar con BI». Sube abajo el reporte de BI del mes." };
  const r = c.resultado;
  if (r.coincide) return { nivel: "info", texto: `El control de BI coincide: ${r.cifras.toLocaleString("es-HN")} cifras iguales. Al publicar con el último mes completo, la versión queda conciliada con BI.` };
  const partes = [
    r.total_diferencias > 0 && `${r.total_diferencias.toLocaleString("es-HN")} de ${r.cifras.toLocaleString("es-HN")} cifras distintas`,
    ...mesesSinCubrir(r),
  ].filter(Boolean);
  return { nivel: "revisar", texto: `El control de BI no coincide: ${partes.join("; ")}. Las diferencias están abajo; si se publica así, la versión queda «sin conciliar con BI».` };
}
