/**
 * Estado del dashboard en la URL (?periodo=2026-09&comparar=anio&canal=…&ruta=…&marca=…&producto=…).
 * La misma cadena viaja al asistente ("Preguntar al asistente") y a la exportación, así heredan los filtros.
 */
import { capital, fechaCorta, periodoLargo } from "@/lib/format";
import type { Comparacion, Filtros, Periodo, PeriodoMeta } from "@/lib/semantic/contracts";

export type EstadoDashboard = { periodo: Periodo; comparar: Comparacion; filtros: Filtros };
type SearchParams = Record<string, string | string[] | undefined>;

/** Parámetro de URL → clave de Filtros. "producto" es art_codigo en el contrato. */
const FILTROS_URL = [["canal", "canal"], ["ruta", "ruta"], ["marca", "marca"], ["producto", "art_codigo"]] as const;

/**
 * S1: la hoja "Ene 025-Ago 026" trae exactamente 1,000,000 filas. El resumen trimestral que envió BIA (6-nov-2026)
 * coincide al centavo desde jul-2025; ene–jun 2025 difiere en L 415 mil (0.05 %). Solo esos meses quedan marcados.
 */
export const S1_SIN_CERTIFICAR_HASTA: Periodo = { anio: 2025, mes: 6 };

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const clave = (p: Periodo) => p.anio * 100 + p.mes;

export function leerParams(sp: SearchParams, periodos: PeriodoMeta[]): EstadoDashboard {
  const pedido = /^(\d{4})-(\d{2})$/.exec(uno(sp.periodo) ?? "");
  const disponible = pedido && periodos.find((p) => p.anio === +pedido[1] && p.mes === +pedido[2]);
  // S7: por defecto el último mes cerrado; si no hay ninguno, el último disponible.
  const porDefecto = periodos.findLast((p) => p.cerrado) ?? periodos.at(-1);
  const elegido = disponible || porDefecto;
  const filtros: Filtros = {};
  for (const [url, campo] of FILTROS_URL) {
    const v = uno(sp[url]);
    if (v) filtros[campo] = v;
  }
  return {
    periodo: elegido ? { anio: elegido.anio, mes: elegido.mes } : { anio: new Date().getFullYear(), mes: 1 },
    comparar: uno(sp.comparar) === "anio" ? "anio" : "anterior",
    filtros,
  };
}

export function periodoComparado(p: Periodo, comparar: Comparacion): Periodo {
  if (comparar === "anio") return { anio: p.anio - 1, mes: p.mes };
  return p.mes === 1 ? { anio: p.anio - 1, mes: 12 } : { anio: p.anio, mes: p.mes - 1 };
}

export function queryString(e: EstadoDashboard): string {
  const q = new URLSearchParams();
  q.set("periodo", `${e.periodo.anio}-${String(e.periodo.mes).padStart(2, "0")}`);
  if (e.comparar !== "anterior") q.set("comparar", e.comparar);
  for (const [url, campo] of FILTROS_URL) {
    const v = e.filtros[campo];
    if (v) q.set(url, v);
  }
  return q.toString();
}

/** Advertencias que acompañan las cifras (pie del dashboard y evidencia del asistente). */
export function advertencias(periodo: Periodo, comparado: Periodo, periodos: PeriodoMeta[]): string[] {
  const out: string[] = [];
  for (const p of [periodo, comparado]) {
    const meta = periodos.find((m) => m.anio === p.anio && m.mes === p.mes);
    if (!meta) out.push(`${capital(periodoLargo(p))} no tiene datos en esta versión: la comparación es contra cero.`);
    else if (!meta.cerrado) out.push(`${capital(periodoLargo(p))} parcial: ${meta.dias} días con venta, corte ${fechaCorta(meta.ultimo_dia)}.`);
  }
  // Solo los meses que la versión tiene: uno sin datos ya tiene su propio aviso.
  const sinCertificar = [periodo, comparado]
    .filter((p) => clave(p) <= clave(S1_SIN_CERTIFICAR_HASTA) && periodos.some((m) => m.anio === p.anio && m.mes === p.mes))
    .map((p, i) => (i === 0 ? capital(periodoLargo(p)) : periodoLargo(p)));
  if (sinCertificar.length)
    out.push(`${sinCertificar.join(" y ")} sin certificar, con diferencias menores contra el resumen trimestral que envió BIA: ene–jun 2025 suma L 415 mil más ahí (0.05 %) (S1).`);
  return [...new Set(out)];
}
