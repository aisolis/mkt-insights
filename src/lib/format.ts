/** Formatos de cifras y fechas en español (Honduras). Solo presentación: los valores ya vienen calculados. */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const entero = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 0 });
const uno = new Intl.NumberFormat("es-HN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dos = new Intl.NumberFormat("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const mesNombre = (mes: number) => MESES[mes - 1];
export const mesCorto = (mes: number) => MESES_CORTOS[mes - 1];
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "septiembre 2026" */
export const periodoLargo = (p: { anio: number; mes: number }) => `${mesNombre(p.mes)} ${p.anio}`;
/** "sep 2026" */
export const periodoCorto = (p: { anio: number; mes: number }) => `${mesCorto(p.mes)} ${p.anio}`;

/** "2026-10-15" → "15-oct-2026" (sin pasar por Date: evita corrimientos de zona horaria). */
export function fechaCorta(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${mesCorto(m)}-${a}`;
}

const DIA_HN = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" });
/** Fecha corta de un instante (timestamptz) en hora de Honduras, no en UTC. */
export function fechaLocal(instante: string) {
  return fechaCorta(DIA_HN.format(new Date(instante)));
}

/** Lempiras compactos: "L 140.2 M", "L 763", "−L 8.4 M". */
export function lempirasCompacto(v: number) {
  const s = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e6) return `${s}L ${uno.format(a / 1e6)} M`;
  if (a >= 1e3) return `${s}L ${uno.format(a / 1e3)} k`;
  return `${s}L ${entero.format(a)}`;
}
/** Lempiras exactos para tablas y exportación: "L 140,170,115.00". */
export const lempiras = (v: number) => `${v < 0 ? "−" : ""}L ${dos.format(Math.abs(v))}`;
export const toneladas = (kg: number) => `${entero.format(kg / 1000)}`;
export const precioKg = (v: number | null) => (v === null ? "—" : `L ${dos.format(v)}`);
export const conteo = (v: number) => entero.format(v);
export const porcentaje = (v: number) => `${uno.format(Math.abs(v))}%`;
