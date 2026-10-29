/** Formatos y normalización de texto del asistente. Solo presentación: las cifras ya vienen calculadas. */
import { lempirasCompacto, periodoLargo, porcentaje } from "@/lib/format";
import { variacionPct, type Filtros, type Periodo, type VersionVigente } from "@/lib/semantic/contracts";

/** Minúsculas y sin tildes, para comparar lo que escribe el usuario con los catálogos. */
export const normalizar = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** "+2.8%", "−6.9%", "sin base" */
export function pctTexto(actual: number, base: number) {
  const p = variacionPct(actual, base);
  return p === null ? "sin base" : `${p < 0 ? "−" : p > 0 ? "+" : ""}${porcentaje(p)}`;
}

/** "+L 1.2 M" / "−L 8.4 M" */
export const lempirasSigno = (v: number) => (v > 0 ? `+${lempirasCompacto(v)}` : lempirasCompacto(v));

/** Participación de una parte en la variación total ("80.4%"), solo si van en el mismo sentido. */
export function participacion(parte: number, total: number) {
  return total !== 0 && Math.sign(parte) === Math.sign(total) ? porcentaje((parte / total) * 100) : null;
}

export const periodoTxt = (p: Periodo) => `${p.anio}-${String(p.mes).padStart(2, "0")}`;
export function leerPeriodo(s: string): Periodo | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s.trim());
  return m && +m[2] >= 1 && +m[2] <= 12 ? { anio: +m[1], mes: +m[2] } : null;
}

export function nombreProducto(codigo: string, meta: VersionVigente["metadatos"]) {
  const p = meta.producto.find((x) => x.codigo === codigo);
  return p ? `${p.descripcion} (${codigo})` : codigo;
}

/** "canal Mayoreo · marca ORO" o "sin filtros (Honduras, todos los canales)" */
export function describirFiltros(f: Filtros, meta: VersionVigente["metadatos"]) {
  const partes: string[] = [];
  if (f.empresa) partes.push(`empresa ${f.empresa}`);
  if (f.canal) partes.push(`canal ${f.canal}`);
  if (f.ruta) partes.push(`ruta ${f.ruta}`);
  if (f.marca) partes.push(`marca ${f.marca}`);
  if (f.art_codigo) partes.push(`producto ${nombreProducto(f.art_codigo, meta)}`);
  return partes.length ? partes.join(" · ") : "sin filtros (Honduras, todos los canales)";
}

export const rango = (p: Periodo, c: Periodo) => `${periodoLargo(p)} vs. ${periodoLargo(c)}`;
