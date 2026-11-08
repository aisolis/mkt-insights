/**
 * Resumen ejecutivo del mes (G9, S21): venta neta, kg, precio/kg y clientes con compra del mes contra el mes
 * anterior y el mismo mes del año anterior; los canales, rutas y marcas que explican la variación; y las
 * advertencias (mes parcial, sin conciliar con BI, versión retirada). Todas las cifras salen de las funciones del
 * contrato semántico (kpi_periodo, variacion_por_dimension); aquí solo se ordenan y se redactan.
 * Sin "server-only": la página y el correo lo usan con la sesión de la persona; las pruebas, con service_role.
 */
import { advertencias, leerParams, periodoComparado } from "@/lib/dashboard/params";
import { capital, conteo, fechaCorta, fechaLocal, lempirasCompacto, periodoLargo, precioKg, toneladas } from "@/lib/format";
import type { crearConsultas } from "@/lib/semantic/consultas";
import { variacionPct, type Kpi, type Periodo, type PeriodoMeta, type VariacionFila } from "@/lib/semantic/contracts";

type Consultas = ReturnType<typeof crearConsultas>;

/** Cabecera de una versión publicada (ventas.version_publicada), vigente o no. */
export type VersionResumen = {
  version: number; fecha_corte: string; conciliada_bi: boolean; publicado_en: string; archivo: string;
  retirada_en: string | null; vigente: boolean; periodos: PeriodoMeta[];
};

export type FuenteResumen = {
  version: (n: number | null) => Promise<VersionResumen | null>;
  kpiPeriodo: Consultas["kpiPeriodo"];
  variacionPorDimension: Consultas["variacionPorDimension"];
};

export type ClaveIndicador = "venta_neta" | "kg" | "precio_kg" | "clientes_con_compra";
export type Indicador = {
  clave: ClaveIndicador; titulo: string; valor: number | null; texto: string;
  anterior: number | null; anio: number | null; pctAnterior: number | null; pctAnio: number | null;
};
export type DimensionResumen = "canal" | "ruta" | "marca";
export type FilaExplicacion = VariacionFila & { peso: number | null };
export type Explicacion = { contra: "anterior" | "anio"; periodo: Periodo; total: number; dimensiones: { dimension: DimensionResumen; titulo: string; filas: FilaExplicacion[] }[] };

export type ResumenMes = {
  version: VersionResumen; periodo: Periodo; anterior: Periodo; anioAnterior: Periodo;
  indicadores: Indicador[]; explicaciones: Explicacion[]; avisos: string[]; titular: string;
};

export const DIMENSIONES_RESUMEN: { dimension: DimensionResumen; titulo: string; limite: number }[] = [
  { dimension: "canal", titulo: "Canales", limite: 6 },
  { dimension: "ruta", titulo: "Rutas", limite: 5 },
  { dimension: "marca", titulo: "Marcas", limite: 5 },
];

const TITULOS: Record<ClaveIndicador, string> = {
  venta_neta: "Venta neta", kg: "Volumen (t)", precio_kg: "Precio promedio por kg", clientes_con_compra: "Clientes con compra",
};
const TEXTO: Record<ClaveIndicador, (v: number | null) => string> = {
  venta_neta: (v) => lempirasCompacto(v ?? 0),
  kg: (v) => `${toneladas(v ?? 0)} t`,
  precio_kg: (v) => precioKg(v),
  clientes_con_compra: (v) => conteo(v ?? 0),
};
const CMP: Record<ClaveIndicador, keyof Kpi> = { venta_neta: "venta_neta_cmp", kg: "kg_cmp", precio_kg: "precio_kg_cmp", clientes_con_compra: "clientes_con_compra_cmp" };

/** "+3.4 %", "−12.0 %" o "sin base". */
export const pctTexto = (p: number | null) => (p === null ? "sin base" : `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)} %`);

const pct = (a: number | null, b: number | null) => (a === null || b === null ? null : variacionPct(a, b));

/** Las filas que más mueven la variación, con su peso sobre la variación total. */
function principales(filas: VariacionFila[], limite: number): FilaExplicacion[] {
  const total = filas.reduce((s, f) => s + f.variacion, 0);
  return [...filas]
    .filter((f) => f.variacion !== 0)
    .sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion) || a.valor.localeCompare(b.valor))
    .slice(0, limite)
    .map((f) => ({ ...f, peso: total === 0 ? null : (f.variacion / Math.abs(total)) * 100 }));
}

export type EntradaResumen = {
  version: VersionResumen; periodo: Periodo;
  kpiAnterior: Kpi; kpiAnio: Kpi;
  variaciones: Record<"anterior" | "anio", Record<DimensionResumen, VariacionFila[]>>;
};

/** Arma el resumen con cifras ya calculadas (puro: se prueba sin base). */
export function armarResumen(e: EntradaResumen): ResumenMes {
  const { version, periodo } = e;
  const anterior = periodoComparado(periodo, "anterior"), anioAnterior = periodoComparado(periodo, "anio");
  const indicadores: Indicador[] = (Object.keys(TITULOS) as ClaveIndicador[]).map((clave) => {
    const valor = e.kpiAnterior[clave] as number | null;
    const ant = e.kpiAnterior[CMP[clave]] as number | null, anio = e.kpiAnio[CMP[clave]] as number | null;
    return { clave, titulo: TITULOS[clave], valor, texto: TEXTO[clave](valor), anterior: ant, anio, pctAnterior: pct(valor, ant), pctAnio: pct(valor, anio) };
  });
  const explicaciones: Explicacion[] = (["anterior", "anio"] as const).map((contra) => ({
    contra,
    periodo: contra === "anterior" ? anterior : anioAnterior,
    total: e.variaciones[contra].canal.reduce((s, f) => s + f.variacion, 0),
    dimensiones: DIMENSIONES_RESUMEN.map(({ dimension, titulo, limite }) => ({ dimension, titulo, filas: principales(e.variaciones[contra][dimension], limite) })),
  }));

  const avisos = [...new Set([
    ...advertencias(periodo, anterior, version.periodos),
    ...advertencias(periodo, anioAnterior, version.periodos),
  ])];
  if (version.retirada_en) avisos.unshift(`La versión v${version.version} fue retirada el ${fechaLocal(version.retirada_en)}: estas cifras ya no son las vigentes.`);
  else if (!version.vigente) avisos.unshift(`La versión v${version.version} no es la vigente: hay una versión publicada más reciente.`);
  if (!version.conciliada_bi) avisos.push(`La versión v${version.version} no está conciliada con BI: confirma las cifras con el reporte de BI antes de comunicarlas.`);

  const vn = indicadores[0];
  const titular = `${capital(periodoLargo(periodo))}: venta neta de ${vn.texto}, ${pctTexto(vn.pctAnterior)} frente a ${periodoLargo(anterior)} y ${pctTexto(vn.pctAnio)} frente a ${periodoLargo(anioAnterior)}.`;
  return { version, periodo, anterior, anioAnterior, indicadores, explicaciones, avisos, titular };
}

type Params = Record<string, string | string[] | undefined>;

/** Versión pedida (?version=N, la vigente si no viene) y periodo (?periodo=YYYY-MM, por defecto el último mes cerrado). */
export async function datosResumen(f: FuenteResumen, sp: Params): Promise<ResumenMes | null> {
  const n = Number(Array.isArray(sp.version) ? sp.version[0] : sp.version);
  const version = await f.version(Number.isInteger(n) && n > 0 ? n : null);
  if (!version || !version.periodos.length) return null;
  const { periodo } = leerParams({ periodo: sp.periodo }, version.periodos);
  const anterior = periodoComparado(periodo, "anterior"), anioAnterior = periodoComparado(periodo, "anio");
  const v = version.version;
  const variacion = (comparar: Periodo, dimension: DimensionResumen) => f.variacionPorDimension({ version: v, dimension, periodo, comparar, filtros: {} });
  const [kpiAnterior, kpiAnio, ...vars] = await Promise.all([
    f.kpiPeriodo({ version: v, periodo, comparar: anterior, filtros: {} }),
    f.kpiPeriodo({ version: v, periodo, comparar: anioAnterior, filtros: {} }),
    ...DIMENSIONES_RESUMEN.map((d) => variacion(anterior, d.dimension)),
    ...DIMENSIONES_RESUMEN.map((d) => variacion(anioAnterior, d.dimension)),
  ]);
  const k = DIMENSIONES_RESUMEN.length;
  const porDimension = (desde: number) => Object.fromEntries(DIMENSIONES_RESUMEN.map((d, i) => [d.dimension, vars[desde + i]])) as Record<DimensionResumen, VariacionFila[]>;
  return armarResumen({ version, periodo, kpiAnterior, kpiAnio, variaciones: { anterior: porDimension(0), anio: porDimension(k) } });
}

/** "/resumen?version=3&periodo=2026-10" */
export const rutaResumen = (r: Pick<ResumenMes, "version" | "periodo">) =>
  `/resumen?version=${r.version.version}&periodo=${r.periodo.anio}-${String(r.periodo.mes).padStart(2, "0")}`;

// Correo -----------------------------------------------------------------------------------------------------------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Asunto, HTML y texto del correo al publicar. `url`: enlace absoluto a la página del resumen. */
export function correoResumen(r: ResumenMes, url: string): { asunto: string; html: string; texto: string } {
  const asunto = `BIA Foresight · Resumen de ${periodoLargo(r.periodo)} (versión v${r.version.version})`;
  const filasKpi = r.indicadores.map((i) =>
    `<tr><td style="padding:4px 12px 4px 0">${esc(i.titulo)}</td><td style="padding:4px 12px;text-align:right"><b>${esc(i.texto)}</b></td>` +
    `<td style="padding:4px 12px;text-align:right">${esc(pctTexto(i.pctAnterior))}</td><td style="padding:4px 0 4px 12px;text-align:right">${esc(pctTexto(i.pctAnio))}</td></tr>`).join("");
  const canales = r.explicaciones[0].dimensiones[0].filas.slice(0, 3)
    .map((f) => `${f.valor} (${f.variacion >= 0 ? "+" : "−"}${lempirasCompacto(Math.abs(f.variacion))})`).join(", ");
  const corte = `Versión v${r.version.version}, corte ${fechaCorta(r.version.fecha_corte)}.`;
  const html = [
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#171717;max-width:640px">`,
    `<p>${esc(r.titular)}</p>`,
    `<table style="border-collapse:collapse;font-size:13px"><tr style="color:#737373"><td></td><td style="padding:4px 12px;text-align:right">${esc(capital(periodoLargo(r.periodo)))}</td>`,
    `<td style="padding:4px 12px;text-align:right">vs. ${esc(periodoLargo(r.anterior))}</td><td style="padding:4px 0 4px 12px;text-align:right">vs. ${esc(periodoLargo(r.anioAnterior))}</td></tr>${filasKpi}</table>`,
    canales ? `<p>Canales que más movieron la venta frente a ${esc(periodoLargo(r.anterior))}: ${esc(canales)}.</p>` : "",
    r.avisos.length ? `<p style="color:#92400e"><b>Ten en cuenta:</b></p><ul style="color:#92400e">${r.avisos.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : "",
    `<p><a href="${esc(url)}">Ver el resumen completo en BIA Foresight</a></p>`,
    `<p style="color:#737373;font-size:12px">${esc(corte)} Cifras del cubo de ventas publicado; el detalle está en el dashboard.</p></div>`,
  ].join("");
  const texto = [
    r.titular, "",
    ...r.indicadores.map((i) => `${i.titulo}: ${i.texto} (${pctTexto(i.pctAnterior)} vs. ${periodoLargo(r.anterior)}; ${pctTexto(i.pctAnio)} vs. ${periodoLargo(r.anioAnterior)})`),
    ...(canales ? ["", `Canales que más movieron la venta frente a ${periodoLargo(r.anterior)}: ${canales}.`] : []),
    ...(r.avisos.length ? ["", "Ten en cuenta:", ...r.avisos.map((a) => `- ${a}`)] : []),
    "", `Resumen completo: ${url}`, corte,
  ].join("\n");
  return { asunto, html, texto };
}
