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
  fecha: "fecha",
  texto: "texto",
  codigo: "código",
  numero: "número",
  numero_opcional: "número, admite celdas vacías",
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
  /** `alternativo`: se usó un nombre que no es el principal (el primero de la lista). */
  encontrados: { campo: Campo; encabezado: string; columna: number; alternativo: boolean }[];
  /** Obligatorios que no están: la hoja no se carga. */
  faltan: Campo[];
  /** Opcionales que no están: se cargan vacíos y la carga lo avisa. */
  faltanOpcionales: Campo[];
  /** Dos columnas con el mismo nombre para un campo: la hoja no se carga (no se sabe cuál usar). */
  repetidos: { campo: Campo; encabezados: string[] }[];
  /** Columnas de un campo que también vinieron con un nombre de menor prioridad y no se usaron. */
  descartadas: { campo: Campo; encabezado: string; usada: string }[];
  sinUsar: string[];
  valida: boolean;
};

/**
 * Los nombres de cada campo van en orden de prioridad: el primero es el principal y los demás, alternativos. Si el
 * archivo trae varios, se usa el de mayor prioridad y los otros quedan como descartados (no es error). Solo es
 * error que el nombre ganador aparezca en dos columnas: ahí no hay forma de saber cuál usar.
 */
export function leerEncabezados(cabecera: string[], m: MapeoCarga): LecturaHoja {
  const campoDe = new Map<string, { campo: Campo; prioridad: number }>();
  for (const c of m.columnas) c.encabezados.forEach((e, prioridad) => campoDe.set(normalizarEncabezado(e), { campo: c.campo, prioridad }));
  const columnas = new Map<Campo, { columna: number; prioridad: number }[]>();
  const sinUsar: string[] = [];
  cabecera.forEach((e, i) => {
    const n = normalizarEncabezado(e);
    if (!n) return;
    const d = campoDe.get(n);
    if (d) columnas.set(d.campo, [...(columnas.get(d.campo) ?? []), { columna: i, prioridad: d.prioridad }]);
    else sinUsar.push(e.trim());
  });
  const l: LecturaHoja = { indices: {}, encontrados: [], faltan: [], faltanOpcionales: [], repetidos: [], descartadas: [], sinUsar, valida: false };
  for (const c of m.columnas) {
    const cols = columnas.get(c.campo) ?? [];
    if (!cols.length) {
      if (c.obligatoria) l.faltan.push(c.campo);
      else l.faltanOpcionales.push(c.campo);
      continue;
    }
    const mejor = Math.min(...cols.map((x) => x.prioridad));
    const ganadoras = cols.filter((x) => x.prioridad === mejor);
    if (ganadoras.length > 1) {
      l.repetidos.push({ campo: c.campo, encabezados: ganadoras.map((x) => cabecera[x.columna].trim()) });
      continue;
    }
    const g = ganadoras[0], usada = cabecera[g.columna].trim();
    l.indices[c.campo] = g.columna;
    l.encontrados.push({ campo: c.campo, encabezado: usada, columna: g.columna, alternativo: g.prioridad > 0 });
    for (const x of cols) if (x !== g) l.descartadas.push({ campo: c.campo, encabezado: cabecera[x.columna].trim(), usada });
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
  for (const r of l.repetidos) partes.push(`hay dos columnas con el mismo nombre para ${CAMPOS[r.campo].etiqueta.toLowerCase()}: ${lista(r.encabezados)}`);
  const trae = cabecera.map((e) => e.trim()).filter(Boolean);
  return `Hoja «${hoja}» (fila ${m.filaEncabezado}): ${partes.join("; ")}. Encabezados del archivo: ${trae.length ? lista(trae.slice(0, 30)) : "ninguno"}${trae.length > 30 ? "…" : ""}.`;
}

/** Lo que queda en ventas.carga.columnas: cómo se leyó cada hoja. */
export type ColumnasHoja =
  | { hoja: string; campos: Partial<Record<Campo, string>>; faltan_opcionales: Campo[]; sin_usar: string[]; descartadas?: { campo: Campo; encabezado: string }[] }
  | { hoja: string; ignorada: string };

/** Columnas opcionales que alguna hoja cargada no traía, en palabras: «Sucursal» (hoja «Hoja1»). */
export function camposVacios(columnas: ColumnasHoja[] | null | undefined): string[] {
  const hojas = (columnas ?? []).filter((h): h is Extract<ColumnasHoja, { campos: unknown }> => "campos" in h);
  const porCampo = new Map<Campo, string[]>();
  for (const h of hojas) for (const c of h.faltan_opcionales) porCampo.set(c, [...(porCampo.get(c) ?? []), h.hoja]);
  return [...porCampo].map(([c, hs]) => `«${CAMPOS[c]?.etiqueta ?? c}»${hojas.length > 1 ? ` (hoja ${hs.map((x) => `«${x}»`).join(", ")})` : ""}`);
}

/** Nombre principal de cada dato en la exportación del cubo (la configuración inicial de 0019). */
export const NOMBRE_CUBO: Record<Campo, string> = {
  fecha: "Fecha", ruta: "Ruta", empresa: "Empresa", marca: "Marca", categoria: "Café/Rep", proveedor: "Proveedor", cliente_codigo: "Cliente Codigo",
  cliente_nombre: "Cliente Nombre", zona: "Zona", documento: "Documento", grupo: "Grupo", canal_origen: "Canal BIA", art_codigo: "ArtCodigo",
  art_descrip: "ArtDescrip", cantidad: "Cantidad", venta_bruta: "Venta Bruta", descuentos: "Descuentos", venta_neta: "Venta Neta", kg: "Kg",
  fardos_caja: "Fardos/Caja", subgrupo: "Subgrupo", sucursal: "Sucursal",
};

/** Los 22 datos en cuatro grupos, para no leer una lista plana. */
export const GRUPOS: { titulo: string; campos: Campo[] }[] = [
  { titulo: "Documento y fecha", campos: ["fecha", "documento", "empresa"] },
  { titulo: "Cliente, ruta y canal", campos: ["ruta", "cliente_codigo", "cliente_nombre", "zona", "sucursal", "canal_origen", "grupo", "subgrupo"] },
  { titulo: "Artículo", campos: ["art_codigo", "art_descrip", "marca", "categoria", "proveedor", "fardos_caja"] },
  { titulo: "Cifras", campos: ["cantidad", "venta_bruta", "descuentos", "venta_neta", "kg"] },
];

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "o", "y", "por", "en"]);
const fichas = (t: string) => new Set(normalizarEncabezado(t).split(" ").filter((x) => x && !VACIAS.has(x)));
/** Parecido entre un encabezado y un nombre: fichas en común sobre la más corta (una ficha cuenta si una empieza con la otra, «cod» ≈ «codigo»). */
function parecido(a: string, b: string) {
  const x = fichas(a), y = fichas(b);
  if (!x.size || !y.size) return 0;
  let comunes = 0;
  for (const p of x) if ([...y].some((q) => q === p || (Math.min(p.length, q.length) >= 3 && (q.startsWith(p) || p.startsWith(q))))) comunes++;
  return comunes / Math.min(x.size, y.size);
}

/**
 * Para cada dato que falta en una hoja, la columna sin usar que más se le parece (a sus nombres o a su etiqueta), si
 * se parece lo bastante. Cada columna se sugiere una sola vez, al dato con el que más se parece.
 */
export function sugerencias(l: LecturaHoja, m: MapeoCarga): { campo: Campo; encabezado: string }[] {
  const pares: { campo: Campo; encabezado: string; puntaje: number }[] = [];
  for (const campo of [...l.faltan, ...l.faltanOpcionales]) {
    const nombres = [...(m.columnas.find((c) => c.campo === campo)?.encabezados ?? []), CAMPOS[campo].etiqueta];
    for (const e of l.sinUsar) {
      const puntaje = Math.max(...nombres.map((n) => parecido(e, n)));
      if (puntaje >= 0.5) pares.push({ campo, encabezado: e, puntaje });
    }
  }
  pares.sort((a, b) => b.puntaje - a.puntaje);
  const usados = new Set<string>(), hechos = new Set<Campo>();
  const r: { campo: Campo; encabezado: string }[] = [];
  for (const p of pares) {
    if (usados.has(p.encabezado) || hechos.has(p.campo)) continue;
    usados.add(p.encabezado); hechos.add(p.campo);
    r.push({ campo: p.campo, encabezado: p.encabezado });
  }
  return r;
}
