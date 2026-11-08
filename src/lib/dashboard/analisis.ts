/**
 * G9 — Análisis comercial: textos y advertencias que comparten el dashboard y el asistente. Solo presentación: las
 * cifras salen de ventas.puente_precio_volumen_mezcla, ventas.acumulado_anio y ventas.rutas_atipicas (0014_analisis.sql).
 */
import { capital, fechaCorta, lempirasCompacto, mesCorto, mesNombre, periodoLargo, porcentaje } from "@/lib/format";
import type { Acumulado, Periodo, PeriodoMeta, Puente, RutaAtipica } from "@/lib/semantic/contracts";
import { S1_SIN_CERTIFICAR_HASTA } from "./params";

const clave = (p: Periodo) => p.anio * 100 + p.mes;
/** Fracción con signo: 0.253 → "+25.3%". */
export const fraccionSigno = (f: number) => `${f < 0 ? "−" : f > 0 ? "+" : ""}${porcentaje(f * 100)}`;
const lempirasSigno = (v: number) => (v > 0 ? `+${lempirasCompacto(v)}` : lempirasCompacto(v));

// Puente precio–volumen–mezcla (S23) -----------------------------------------------------------------------------

export type PasoPuente = { clave: "volumen" | "precio" | "mezcla" | "nuevos" | "descontinuados" | "sin_volumen"; nombre: string; valor: number; explicacion: string };

/** Renglones del puente en orden. Nuevos, descontinuados y ajustes sin kg solo aparecen si hay. */
export function pasosPuente(p: Puente, periodo: Periodo, comparado: Periodo): PasoPuente[] {
  const cmp = periodoLargo(comparado), act = periodoLargo(periodo);
  const pasos: PasoPuente[] = [
    { clave: "volumen", nombre: "Volumen", valor: p.volumen, explicacion: `Vender más o menos kg, al precio promedio por kg de ${cmp}.` },
    { clave: "precio", nombre: "Precio", valor: p.precio, explicacion: "Cambio del precio por kg de cada producto, ya con descuentos." },
    { clave: "mezcla", nombre: "Mezcla", valor: p.mezcla, explicacion: "Más o menos peso de productos caros frente a baratos." },
  ];
  if (p.productos_nuevos || p.nuevos)
    pasos.push({ clave: "nuevos", nombre: "Productos nuevos", valor: p.nuevos, explicacion: `${p.productos_nuevos} productos con kg en ${act} y sin kg en ${cmp}.` });
  if (p.productos_descontinuados || p.descontinuados)
    pasos.push({ clave: "descontinuados", nombre: "Dejaron de venderse", valor: p.descontinuados, explicacion: `${p.productos_descontinuados} productos con kg en ${cmp} y sin kg en ${act}.` });
  if (p.sin_volumen)
    pasos.push({ clave: "sin_volumen", nombre: "Ajustes sin kg", valor: p.sin_volumen, explicacion: "Notas y ajustes de productos sin kg en ninguno de los dos meses." });
  return pasos;
}

/** El efecto (volumen, precio o mezcla) que más pesa, con su signo. */
export function efectoPrincipal(p: Puente): PasoPuente["clave"] {
  const efectos = [["volumen", p.volumen], ["precio", p.precio], ["mezcla", p.mezcla]] as const;
  return [...efectos].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0];
}

// Acumulado del año (S24) ----------------------------------------------------------------------------------------

/** "ene–sep 2026" (o "ene 2026" si el tramo es solo enero). */
export const rangoAcumulado = (anio: number, mes: number) => (mes === 1 ? `${mesCorto(1)} ${anio}` : `${mesCorto(1)}–${mesCorto(mes)} ${anio}`);

/**
 * Advertencias del acumulado, con el mismo criterio que las del mes (params.ts): meses parciales dentro de cada
 * tramo, meses sin datos en la versión y meses sin certificar (S1).
 */
export function advertenciasAcumulado(a: Acumulado, periodos: PeriodoMeta[]): string[] {
  const out: string[] = [];
  const todos = Array.from({ length: a.mes }, (_, i) => i + 1);
  for (const [anio, meses] of [[a.anio, a.meses], [a.anio - 1, a.meses_cmp]] as const) {
    const faltan = todos.filter((m) => !meses.includes(m));
    if (faltan.length === todos.length) out.push(`${rangoAcumulado(anio, a.mes)} no tiene datos en esta versión: el acumulado se compara contra cero.`);
    else if (faltan.length) out.push(`${capital(rangoAcumulado(anio, a.mes))} incompleto: sin datos de ${faltan.map(mesNombre).join(", ")} en esta versión.`);
    for (const p of periodos.filter((x) => x.anio === anio && x.mes <= a.mes && !x.cerrado))
      out.push(`${capital(periodoLargo(p))} parcial: ${p.dias} días con venta, corte ${fechaCorta(p.ultimo_dia)}; el acumulado lo suma tal como está.`);
  }
  const sinCertificar = [a.anio - 1, a.anio].filter((anio) => clave({ anio, mes: 1 }) <= clave(S1_SIN_CERTIFICAR_HASTA) && (anio === a.anio ? a.meses : a.meses_cmp).length);
  if (sinCertificar.length)
    out.push(`El acumulado incluye meses sin certificar (hasta ${periodoLargo(S1_SIN_CERTIFICAR_HASTA)}), con diferencias menores contra el resumen trimestral que envió BIA: ene–jun 2025 suma L 415 mil más ahí (0.05 %) (S1).`);
  return out;
}

// Rutas fuera de lo normal (S25) ---------------------------------------------------------------------------------

/** Rango normal de la ruta: mediana ± 2 escalas, sin bajar de −100 %. */
export const rangoNormal = (r: RutaAtipica) => ({ bajo: Math.max(-1, r.mediana - 2 * r.escala), alto: r.mediana + 2 * r.escala });

/** Motivo en lenguaje llano: cuánto cambió, qué es lo normal para esa ruta y su extremo en la historia. */
export function motivoAtipica(r: RutaAtipica, anterior: Periodo): string {
  const sube = r.cambio > 0;
  const { bajo, alto } = rangoNormal(r);
  const extremo = sube ? r.maximo : r.minimo;
  const record = sube ? r.cambio > r.maximo : r.cambio < r.minimo;
  const palabra = sube ? "subida" : "caída";
  const nunca = sube ? extremo <= 0 : extremo >= 0;
  return `${sube ? "Subió" : "Cayó"} ${fraccionSigno(r.cambio)} vs. ${periodoLargo(anterior)} (${lempirasSigno(r.variacion)}). ` +
    `Lo normal en esta ruta es moverse entre ${fraccionSigno(bajo)} y ${fraccionSigno(alto)} de un mes a otro` +
    (nunca
      ? `; en los ${r.meses_historia} cambios anteriores nunca había ${sube ? "subido" : "caído"}.`
      : record
        ? `; es su mayor ${palabra} en los ${r.meses_historia} cambios anteriores (la más grande había sido ${fraccionSigno(extremo)}).`
        : `; en los ${r.meses_historia} cambios anteriores su mayor ${palabra} fue ${fraccionSigno(extremo)}.`);
}

/** Mes anterior al periodo (las rutas fuera de lo normal siempre comparan contra el mes anterior). */
export const mesAnterior = (p: Periodo): Periodo => (p.mes === 1 ? { anio: p.anio - 1, mes: 12 } : { anio: p.anio, mes: p.mes - 1 });
