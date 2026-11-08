/**
 * Columnas del Excel configurables (G10, S26). Los campos de ventas.hecho y su tipo los define el sistema; desde
 * la app se configura con qué nombres de columna llega cada uno, si puede faltar, la fila de los encabezados y las
 * hojas que se saltan (ventas.columna_carga y ventas.formato_carga, 0019). Sin "server-only": lo usan la ingesta
 * (app y script), el probador y la pantalla de configuración.
 */

export type TipoCampo = "fecha" | "texto" | "codigo" | "numero" | "numero_opcional";

export const CAMPOS = {
  fecha: { etiqueta: "Fecha", tipo: "fecha" },
  ruta: { etiqueta: "Ruta", tipo: "codigo" },
  empresa: { etiqueta: "Empresa", tipo: "texto" },
  marca: { etiqueta: "Marca", tipo: "texto" },
  categoria: { etiqueta: "Categoría (café o representada)", tipo: "texto" },
  proveedor: { etiqueta: "Proveedor", tipo: "texto" },
  cliente_codigo: { etiqueta: "Código de cliente", tipo: "codigo" },
  cliente_nombre: { etiqueta: "Nombre de cliente", tipo: "texto" },
  zona: { etiqueta: "Zona", tipo: "texto" },
  documento: { etiqueta: "Documento (factura)", tipo: "codigo" },
  grupo: { etiqueta: "Grupo", tipo: "texto" },
  canal_origen: { etiqueta: "Canal (antes de homologar)", tipo: "texto" },
  art_codigo: { etiqueta: "Código de artículo", tipo: "codigo" },
  art_descrip: { etiqueta: "Descripción de artículo", tipo: "texto" },
  cantidad: { etiqueta: "Cantidad", tipo: "numero" },
  venta_bruta: { etiqueta: "Venta bruta", tipo: "numero" },
  descuentos: { etiqueta: "Descuentos", tipo: "numero" },
  venta_neta: { etiqueta: "Venta neta", tipo: "numero" },
  kg: { etiqueta: "Kilos", tipo: "numero" },
  fardos_caja: { etiqueta: "Fardos por caja", tipo: "numero_opcional" },
  subgrupo: { etiqueta: "Subgrupo", tipo: "texto" },
  sucursal: { etiqueta: "Sucursal", tipo: "texto" },
} as const satisfies Record<string, { etiqueta: string; tipo: TipoCampo }>;

export type Campo = keyof typeof CAMPOS;
export const esCampo = (c: string): c is Campo => Object.hasOwn(CAMPOS, c);

export const TIPOS: Record<TipoCampo, string> = {
  fecha: "fecha (o número de serie de Excel)",
  texto: "texto",
  codigo: "código (un número se guarda sin decimales)",
  numero: "número (acepta comas de miles)",
  numero_opcional: "número; la celda puede venir vacía",
};

/** Encabezados de la exportación del cubo (el formato de siempre): los que trae la configuración inicial. */
export const ENCABEZADOS_CUBO = ["Fecha", "Ruta", "Empresa", "Marca", "Café/Rep", "Proveedor", "Cliente Codigo", "Cliente Nombre", "Zona", "Documento", "Año", "Mes Nom", "Grupo", "Canal BIA", "ArtCodigo", "ArtDescrip", "Cantidad", "Venta Bruta", "Descuentos", "Venta Neta", "Kg", "Fardos/Caja", "Subgrupo", "Sucursal"] as const;

export type ColumnaCarga = { campo: Campo; encabezados: string[]; obligatoria: boolean; puede_faltar: boolean };
export type MapeoCarga = { columnas: ColumnaCarga[]; filaEncabezado: number; hojasExcluidas: string[] };

/** "Café/Rep", "cafe rep" y " CAFÉ - REP " son el mismo encabezado. Igual que interno._normalizar_encabezado (0019). */
export const normalizarEncabezado = (t: string) =>
  t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const hojaExcluida = (hoja: string, m: MapeoCarga) => {
  const n = normalizarEncabezado(hoja);
  return m.hojasExcluidas.some((h) => normalizarEncabezado(h) === n);
};

/** Cómo se leyeron los encabezados de una hoja. `indices`: columna (base 0) de cada campo encontrado. */
export type LecturaHoja = {
  indices: Partial<Record<Campo, number>>;
  encontrados: { campo: Campo; encabezado: string; columna: number }[];
  /** Obligatorios que no están: la hoja no se carga. */
  faltan: Campo[];
  /** Opcionales que no están: se cargan vacíos y la carga lo avisa. */
  faltanOpcionales: Campo[];
  /** Más de una columna para el mismo campo: la hoja no se carga (no se sabe cuál usar). */
  repetidos: { campo: Campo; encabezados: string[] }[];
  sinUsar: string[];
  valida: boolean;
};

export function leerEncabezados(cabecera: string[], m: MapeoCarga): LecturaHoja {
  const campoDe = new Map<string, Campo>();
  for (const c of m.columnas) for (const e of c.encabezados) campoDe.set(normalizarEncabezado(e), c.campo);
  const columnas = new Map<Campo, number[]>();
  const sinUsar: string[] = [];
  cabecera.forEach((e, i) => {
    const n = normalizarEncabezado(e);
    if (!n) return;
    const campo = campoDe.get(n);
    if (campo) columnas.set(campo, [...(columnas.get(campo) ?? []), i]);
    else sinUsar.push(e.trim());
  });
  const l: LecturaHoja = { indices: {}, encontrados: [], faltan: [], faltanOpcionales: [], repetidos: [], sinUsar, valida: false };
  for (const c of m.columnas) {
    const cols = columnas.get(c.campo) ?? [];
    if (cols.length === 1) {
      l.indices[c.campo] = cols[0];
      l.encontrados.push({ campo: c.campo, encabezado: cabecera[cols[0]].trim(), columna: cols[0] });
    } else if (cols.length > 1) l.repetidos.push({ campo: c.campo, encabezados: cols.map((i) => cabecera[i].trim()) });
    else if (c.obligatoria) l.faltan.push(c.campo);
    else l.faltanOpcionales.push(c.campo);
  }
  l.valida = !l.faltan.length && !l.repetidos.length;
  return l;
}

const lista = (xs: string[]) => xs.map((x) => `«${x}»`).join(", ");

/** Por qué una hoja no se carga, en palabras: qué falta, con qué nombres se acepta y qué encabezados trae. */
export function motivoHoja(hoja: string, l: LecturaHoja, m: MapeoCarga, cabecera: string[]): string {
  const partes: string[] = [];
  for (const campo of l.faltan) {
    const c = m.columnas.find((x) => x.campo === campo)!;
    partes.push(`falta la columna de ${CAMPOS[campo].etiqueta.toLowerCase()} (se acepta como ${lista(c.encabezados)})`);
  }
  for (const r of l.repetidos) partes.push(`hay varias columnas de ${CAMPOS[r.campo].etiqueta.toLowerCase()}: ${lista(r.encabezados)}`);
  const trae = cabecera.map((e) => e.trim()).filter(Boolean);
  return `Hoja «${hoja}» (fila ${m.filaEncabezado}): ${partes.join("; ")}. Encabezados del archivo: ${trae.length ? lista(trae.slice(0, 30)) : "ninguno"}${trae.length > 30 ? "…" : ""}.`;
}

/** Lo que queda en ventas.carga.columnas: cómo se leyó cada hoja. */
export type ColumnasHoja =
  | { hoja: string; campos: Partial<Record<Campo, string>>; faltan_opcionales: Campo[]; sin_usar: string[] }
  | { hoja: string; ignorada: string };

/** Columnas opcionales que alguna hoja cargada no traía, en palabras: «Sucursal» (hoja «Hoja1»). */
export function camposVacios(columnas: ColumnasHoja[] | null | undefined): string[] {
  const hojas = (columnas ?? []).filter((h): h is Extract<ColumnasHoja, { campos: unknown }> => "campos" in h);
  const porCampo = new Map<Campo, string[]>();
  for (const h of hojas) for (const c of h.faltan_opcionales) porCampo.set(c, [...(porCampo.get(c) ?? []), h.hoja]);
  return [...porCampo].map(([c, hs]) => `«${CAMPOS[c]?.etiqueta ?? c}»${hojas.length > 1 ? ` (hoja ${hs.map((x) => `«${x}»`).join(", ")})` : ""}`);
}
