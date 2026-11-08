/**
 * Catálogo cerrado de herramientas del asistente (sin SQL libre). Cada una valida sus argumentos contra la versión
 * publicada, llama una función del contrato semántico y devuelve: datos crudos (para "Ver consulta y datos"),
 * un resumen con cifras ya formateadas (lo único que ve el modelo), hechos redactados y una visual.
 * Nunca devuelven datos de clientes ni subgrupo (S10).
 */
import { z } from "zod";
import type { PuntoSerie } from "@/components/dashboard/serie-chart";
import { capital, conteo, lempiras, lempirasCompacto, periodoCorto, periodoLargo, precioKg, toneladas } from "@/lib/format";
import { advertenciasAcumulado, efectoPrincipal, fraccionSigno, mesAnterior, motivoAtipica, pasosPuente, rangoAcumulado, rangoNormal } from "@/lib/dashboard/analisis";
import type { crearConsultas } from "@/lib/semantic/consultas";
import { Dimension, type Acumulado, type Filtros, type Periodo, type Puente, type RutasAtipicas, type VersionVigente } from "@/lib/semantic/contracts";
import { describirFiltros, lempirasSigno, leerPeriodo, nombreProducto, normalizar, participacion, pctTexto, rango } from "./texto";
import type { Contexto, Fuente, Resultado, Visual } from "./tipos";

const PeriodoArg = z.string().describe("Mes en formato AAAA-MM, p. ej. 2026-09");
const FiltrosArg = z.object({
  canal: z.string().optional(),
  ruta: z.string().optional(),
  marca: z.string().optional(),
  producto: z.string().optional().describe("Código o descripción del artículo"),
  empresa: z.string().optional().describe("MCM o GKSA"),
}).strict().optional().describe("Filtros opcionales; los valores deben existir en la versión publicada");

const DIMENSIONES_TXT: Record<Dimension, string> = {
  canal: "canal", ruta: "ruta", zona: "zona", sucursal: "sucursal", marca: "marca",
  categoria: "categoría (Café/Rep)", art_codigo: "producto", empresa: "empresa",
};

export const CATALOGO = {
  kpi_periodo: {
    descripcion: "Venta neta, volumen (kg), precio promedio por kg y clientes con compra de un mes contra otro, más la cobertura de rutas.",
    args: z.object({ periodo: PeriodoArg, comparado: PeriodoArg, filtros: FiltrosArg }),
  },
  variacion_por_dimension: {
    descripcion: "Variación de venta neta entre dos meses abierta por una dimensión, con la participación de cada valor en la variación total. Devuelve las mayores caídas y los mayores aumentos.",
    args: z.object({ dimension: Dimension, periodo: PeriodoArg, comparado: PeriodoArg, filtros: FiltrosArg, limite: z.number().int().min(1).max(20).optional() }),
  },
  top_rutas: {
    descripcion: "Combinaciones ruta × canal que más contribuyen a la variación de venta neta entre dos meses.",
    args: z.object({ periodo: PeriodoArg, comparado: PeriodoArg, filtros: FiltrosArg, limite: z.number().int().min(1).max(20).optional() }),
  },
  serie_mensual: {
    descripcion: "Venta neta y kg mes a mes de un año, junto al año anterior.",
    args: z.object({ anio: z.number().int(), filtros: FiltrosArg }),
  },
  descomposicion: {
    descripcion: "Descompone la venta de dos meses en clientes con compra, facturas, facturas por cliente, ticket por factura y venta por cliente. Sirve para separar frecuencia de compra de valor por compra.",
    args: z.object({ periodo: PeriodoArg, comparado: PeriodoArg, filtros: FiltrosArg }),
  },
  // G9 — análisis comercial (0014_analisis.sql)
  puente_precio_volumen_mezcla: {
    descripcion: "Separa la variación de venta neta entre dos meses en efecto volumen (vender más o menos kg), efecto precio (precio por kg de cada producto, ya con descuentos), efecto mezcla (más o menos peso de productos caros frente a baratos) y productos nuevos o que dejaron de venderse. Los renglones suman exactamente la variación total. Úsala cuando pregunten si la variación fue por precio, por volumen o por mezcla.",
    args: z.object({ periodo: PeriodoArg, comparado: PeriodoArg, filtros: FiltrosArg }),
  },
  acumulado_anio: {
    descripcion: "Acumulado del año: venta neta, volumen (kg), precio promedio por kg y clientes con compra de enero al mes indicado, contra el mismo tramo del año anterior. Para preguntas de 'en lo que va del año', 'acumulado' o 'YTD'.",
    args: z.object({ periodo: PeriodoArg.describe("Último mes del tramo, en formato AAAA-MM; el tramo va de enero a ese mes"), filtros: FiltrosArg }),
  },
  rutas_atipicas: {
    descripcion: "Rutas cuya variación de venta neta contra el mes anterior se sale de lo normal frente a sus propios cambios de mes a mes de los 12 meses anteriores (regla robusta con mediana; deja fuera las rutas chicas). Devuelve el motivo de cada una en palabras.",
    args: z.object({ periodo: PeriodoArg, filtros: FiltrosArg, limite: z.number().int().min(1).max(20).optional() }),
  },
} as const;
export type NombreHerramienta = keyof typeof CATALOGO;

/** Definición de herramientas en formato OpenAI/OpenRouter. */
export const herramientasModelo = () =>
  Object.entries(CATALOGO).map(([name, h]) => ({
    type: "function" as const,
    function: { name, description: h.descripcion, parameters: z.toJSONSchema(h.args, { io: "input" }) },
  }));

export class ErrorHerramienta extends Error {}

/** Ejecuta una herramienta con argumentos sin validar (vienen del modelo o del intérprete). */
export async function ejecutar(nombre: string, crudos: unknown, ctx: Contexto, id: string): Promise<Resultado> {
  if (!(nombre in CATALOGO)) throw new ErrorHerramienta(`herramienta desconocida: ${nombre}`);
  const h = nombre as NombreHerramienta;
  const parsed = CATALOGO[h].args.safeParse(crudos);
  if (!parsed.success) throw new ErrorHerramienta(`argumentos inválidos para ${h}: ${z.prettifyError(parsed.error)}`);
  const a = parsed.data as Record<string, unknown>;
  const meta = ctx.version.metadatos;
  const v = ctx.version.version;
  const filtros = resolverFiltros((a.filtros ?? {}) as z.infer<typeof FiltrosArg> & object, meta);

  if (h === "serie_mensual") {
    const anio = a.anio as number;
    if (!meta.periodos.some((p) => p.anio === anio)) throw new ErrorHerramienta(`el año ${anio} no tiene datos; hay ${[...new Set(meta.periodos.map((p) => p.anio))].join(", ")}`);
    const [serie, serieAnt] = await Promise.all([
      ctx.fuente.serieMensual({ version: v, anio, filtros }),
      ctx.fuente.serieMensual({ version: v, anio: anio - 1, filtros }),
    ]);
    return serieMensual(id, anio, filtros, serie, serieAnt, ctx);
  }

  if (h === "acumulado_anio") {
    const periodo = periodoValido(a.periodo as string, meta);
    const acu = await analisis(ctx).acumuladoAnio({ version: v, periodo, filtros });
    return acumulado(id, periodo, filtros, acu, ctx);
  }
  if (h === "rutas_atipicas") {
    const periodo = periodoValido(a.periodo as string, meta);
    const limite = (a.limite as number | undefined) ?? 10;
    const r = await analisis(ctx).rutasAtipicas({ version: v, periodo, filtros, limite });
    return rutasAtipicas(id, periodo, filtros, limite, r, ctx);
  }

  const periodo = periodoValido(a.periodo as string, meta);
  const comparado = periodoValido(a.comparado as string, meta);
  const base = { version: v, periodo, comparar: comparado, filtros };
  const comun = { id, herramienta: h, argumentos: { ...a, filtros }, periodo, comparado, filtros };
  const sufijo = Object.keys(filtros).length ? `, ${describirFiltros(filtros, meta)}` : "";

  if (h === "kpi_periodo") {
    const k = await ctx.fuente.kpiPeriodo(base);
    const filas: [string, string, string, string][] = [
      ["Venta neta", lempirasCompacto(k.venta_neta), lempirasCompacto(k.venta_neta_cmp), pctTexto(k.venta_neta, k.venta_neta_cmp)],
      ["Volumen (t)", toneladas(k.kg), toneladas(k.kg_cmp), pctTexto(k.kg, k.kg_cmp)],
      ["Precio promedio (L/kg)", precioKg(k.precio_kg), precioKg(k.precio_kg_cmp), k.precio_kg === null || k.precio_kg_cmp === null ? "sin base" : pctTexto(k.precio_kg, k.precio_kg_cmp)],
      ["Clientes con compra", conteo(k.clientes_con_compra), conteo(k.clientes_con_compra_cmp), pctTexto(k.clientes_con_compra, k.clientes_con_compra_cmp)],
    ];
    const dif = k.venta_neta - k.venta_neta_cmp;
    return {
      ...comun, calculo: "ventas.kpi_periodo", datos: k,
      resumen: {
        indicadores: filas.map(([indicador, actual, anterior, variacion]) => ({ indicador, actual, anterior, variacion })),
        diferencia_venta_neta: lempirasSigno(dif),
        cobertura: `${k.rutas_con_venta}/${k.rutas_total} rutas con venta`,
      },
      hechos: [
        `Venta neta ${periodoLargo(periodo)}: ${lempirasCompacto(k.venta_neta)} vs. ${lempirasCompacto(k.venta_neta_cmp)} en ${periodoLargo(comparado)} (${lempirasSigno(dif)}, ${pctTexto(k.venta_neta, k.venta_neta_cmp)}${sufijo}).`,
        `Volumen ${toneladas(k.kg)} t vs. ${toneladas(k.kg_cmp)} t (${pctTexto(k.kg, k.kg_cmp)}); precio promedio ${precioKg(k.precio_kg)}/kg vs. ${precioKg(k.precio_kg_cmp)}/kg.`,
      ],
      visual: { tipo: "tabla", titulo: `Indicadores · ${rango(periodo, comparado)}`, columnas: ["Indicador", capital(periodoCorto(periodo)), capital(periodoCorto(comparado)), "Variación"], filas },
    };
  }

  if (h === "variacion_por_dimension") {
    const dim = a.dimension as Dimension;
    const limite = (a.limite as number | undefined) ?? 8;
    const crudo = (await ctx.fuente.variacionPorDimension({ ...base, dimension: dim }))
      .map((f) => (dim === "art_codigo" ? { ...f, valor: nombreProducto(f.valor, meta) } : f));
    const filas = crudo.filter((f) => f.actual !== 0 || f.anterior !== 0);
    const total = filas.reduce((s, f) => s + f.variacion, 0);
    const fmt = (f: (typeof filas)[number]) => ({
      valor: f.valor, actual: lempirasCompacto(f.actual), anterior: lempirasCompacto(f.anterior),
      variacion: lempirasSigno(f.variacion), variacion_pct: pctTexto(f.actual, f.anterior),
      participacion_en_variacion: participacion(f.variacion, total),
    });
    const caidas = filas.filter((f) => f.variacion < 0).slice(0, limite);
    const aumentos = filas.filter((f) => f.variacion > 0).reverse().slice(0, limite);
    const principales = total < 0 ? caidas : aumentos;
    const contrarios = total < 0 ? aumentos : caidas;
    const nombre = DIMENSIONES_TXT[dim];
    const hechos: string[] = [];
    if (principales.length) {
      const [p1, ...resto] = principales;
      const part = participacion(p1.variacion, total);
      hechos.push(
        `Por ${nombre}, la variación total de ${lempirasSigno(total)} se concentra en ${p1.valor} (${lempirasSigno(p1.variacion)}${part ? `, ${part} de la variación` : ""})` +
        (resto.length ? `, seguido de ${resto.slice(0, 2).map((f) => `${f.valor} (${lempirasSigno(f.variacion)})`).join(" y ")}.` : "."),
      );
    } else hechos.push(`Por ${nombre}, no hay variación de venta neta entre ${rango(periodo, comparado)}.`);
    if (contrarios.length)
      hechos.push(`En sentido contrario: ${contrarios.slice(0, 3).map((f) => `${f.valor} (${lempirasSigno(f.variacion)})`).join(", ")}.`);
    // Para la gráfica: los de mayor peso, de la mayor caída al mayor aumento.
    const graf = [...filas].sort((x, y) => Math.abs(y.variacion) - Math.abs(x.variacion)).slice(0, Math.max(limite, 6)).sort((x, y) => x.variacion - y.variacion);
    return {
      ...comun, argumentos: { ...comun.argumentos, limite }, calculo: "ventas.variacion_por_dimension", datos: crudo,
      resumen: { dimension: nombre, variacion_total: lempirasSigno(total), valores_con_venta: filas.length, mayores_caidas: caidas.map(fmt), mayores_aumentos: aumentos.map(fmt) },
      hechos,
      visual: { tipo: "variacion", titulo: `Variación por ${nombre} · ${rango(periodo, comparado)}`, filas: graf },
    };
  }

  if (h === "top_rutas") {
    const limite = (a.limite as number | undefined) ?? 10;
    const filas = await ctx.fuente.topContribuyentes({ ...base, limite });
    const [r1] = filas;
    return {
      ...comun, argumentos: { ...comun.argumentos, limite }, calculo: "ventas.top_contribuyentes", datos: filas,
      resumen: filas.map((r) => ({ ruta: r.ruta, canal: r.canal, actual: lempirasCompacto(r.actual), anterior: lempirasCompacto(r.anterior), variacion: lempirasSigno(r.variacion), variacion_pct: pctTexto(r.actual, r.anterior) })),
      hechos: r1 ? [`La ruta con más peso en la variación es ${r1.ruta} en ${r1.canal}: ${lempirasCompacto(r1.actual)} vs. ${lempirasCompacto(r1.anterior)} (${lempirasSigno(r1.variacion)}).`] : [],
      visual: {
        tipo: "tabla", titulo: `Rutas que más contribuyen · ${rango(periodo, comparado)}`,
        columnas: ["Ruta", "Canal", capital(periodoCorto(periodo)), capital(periodoCorto(comparado)), "Variación"],
        filas: filas.map((r) => [r.ruta, r.canal, lempirasCompacto(r.actual), lempirasCompacto(r.anterior), lempirasSigno(r.variacion)]),
      },
    };
  }

  if (h === "puente_precio_volumen_mezcla") {
    const p = await analisis(ctx).puentePrecioVolumenMezcla({ ...base, limite: 5 });
    return { ...comun, ...puente(p, periodo, comparado, sufijo) };
  }

  // descomposicion
  const d = await ctx.fuente.descomposicion(base);
  const A = d.actual, B = d.anterior;
  const n = (x: number | null) => (x === null ? "—" : String(x));
  const filas: [string, string, string, string][] = [
    ["Clientes con compra", conteo(A.clientes), conteo(B.clientes), pctTexto(A.clientes, B.clientes)],
    ["Facturas", conteo(A.facturas), conteo(B.facturas), pctTexto(A.facturas, B.facturas)],
    ["Facturas por cliente", n(A.facturas_por_cliente), n(B.facturas_por_cliente), A.facturas_por_cliente === null || B.facturas_por_cliente === null ? "sin base" : pctTexto(A.facturas_por_cliente, B.facturas_por_cliente)],
    ["Ticket por factura", A.ticket_factura === null ? "—" : lempiras(A.ticket_factura), B.ticket_factura === null ? "—" : lempiras(B.ticket_factura), A.ticket_factura === null || B.ticket_factura === null ? "sin base" : pctTexto(A.ticket_factura, B.ticket_factura)],
    ["Venta por cliente", A.venta_por_cliente === null ? "—" : lempiras(A.venta_por_cliente), B.venta_por_cliente === null ? "—" : lempiras(B.venta_por_cliente), A.venta_por_cliente === null || B.venta_por_cliente === null ? "sin base" : pctTexto(A.venta_por_cliente, B.venta_por_cliente)],
  ];
  return {
    ...comun, calculo: "ventas.descomposicion", datos: d,
    resumen: filas.map(([indicador, actual, anterior, variacion]) => ({ indicador, actual, anterior, variacion })),
    hechos: [hechoDescomposicion(d)],
    visual: { tipo: "tabla", titulo: `Clientes, facturas y ticket · ${rango(periodo, comparado)}`, columnas: ["Indicador", capital(periodoCorto(periodo)), capital(periodoCorto(comparado)), "Variación"], filas },
  };
}

function hechoDescomposicion({ actual: A, anterior: B }: { actual: Lado; anterior: Lado }) {
  const base = `Clientes con compra ${pctTexto(A.clientes, B.clientes)}, facturas ${pctTexto(A.facturas, B.facturas)}`;
  if (A.ticket_factura === null || B.ticket_factura === null) return `${base}.`;
  const dFac = Math.abs(A.facturas / (B.facturas || 1) - 1), dTic = Math.abs(A.ticket_factura / B.ticket_factura - 1);
  const ticket = `ticket por factura ${pctTexto(A.ticket_factura, B.ticket_factura)}`;
  const lectura = dTic > dFac ? "la variación viene del valor por factura más que de la cantidad de facturas" : "la variación viene de la cantidad de facturas más que del valor por factura";
  return `${base} y ${ticket}: ${lectura} (venta neta = facturas × ticket).`;
}
type Lado = { clientes: number; facturas: number; ticket_factura: number | null };

function serieMensual(id: string, anio: number, filtros: Filtros, serie: { mes: number; venta_neta: number }[], ant: { mes: number; venta_neta: number }[], ctx: Contexto): Resultado {
  const meta = ctx.version.metadatos;
  const puntos: PuntoSerie[] = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((mes) => ({
      mes,
      actual: serie.find((p) => p.mes === mes)?.venta_neta ?? null,
      anterior: ant.find((p) => p.mes === mes)?.venta_neta ?? null,
      parcial: meta.periodos.some((p) => p.anio === anio && p.mes === mes && !p.cerrado),
    }))
    .filter((p) => p.actual !== null || p.anterior !== null);
  const conDatos = puntos.filter((p) => p.actual !== null && !p.parcial);
  const max = conDatos.reduce<PuntoSerie | null>((m, p) => (!m || p.actual! > m.actual! ? p : m), null);
  const min = conDatos.reduce<PuntoSerie | null>((m, p) => (!m || p.actual! < m.actual! ? p : m), null);
  const hechos = max && min ? [`En ${anio} (meses cerrados${describirFiltros(filtros, meta).startsWith("sin") ? "" : `, ${describirFiltros(filtros, meta)}`}), el mes más alto fue ${periodoLargo({ anio, mes: max.mes })} con ${lempirasCompacto(max.actual!)} y el más bajo ${periodoLargo({ anio, mes: min.mes })} con ${lempirasCompacto(min.actual!)}.`] : [];
  return {
    id, herramienta: "serie_mensual", argumentos: { anio, filtros }, calculo: "ventas.serie_mensual", filtros, datos: { anio: serie, anio_anterior: ant },
    resumen: puntos.map((p) => ({ mes: periodoCorto({ anio, mes: p.mes }), venta_neta: p.actual === null ? null : lempirasCompacto(p.actual), anio_anterior: p.anterior === null ? null : lempirasCompacto(p.anterior), variacion_interanual: p.actual === null || p.anterior === null ? null : pctTexto(p.actual, p.anterior), parcial: p.parcial })),
    hechos,
    visual: { tipo: "serie", titulo: `Venta neta mensual ${anio} · L millones · línea punteada: ${anio - 1}`, anio, mesSeleccionado: ctx.estado.periodo.anio === anio ? ctx.estado.periodo.mes : 0, puntos } satisfies Visual,
  };
}

// G9 — análisis comercial -----------------------------------------------------------------------------------------

type FuenteAnalisis = Pick<ReturnType<typeof crearConsultas>, "puentePrecioVolumenMezcla" | "acumuladoAnio" | "rutasAtipicas">;

/** Las consultas de G9 viajan en la misma fuente (en la app, src/lib/semantic/queries); un doble sin ellas falla claro. */
function analisis(ctx: Contexto): FuenteAnalisis {
  const f = ctx.fuente as Fuente & Partial<FuenteAnalisis>;
  if (!f.puentePrecioVolumenMezcla || !f.acumuladoAnio || !f.rutasAtipicas) throw new ErrorHerramienta("el análisis comercial no está disponible en esta fuente de datos");
  return f as FuenteAnalisis;
}

const EFECTO_TXT = { volumen: "volumen", precio: "precio", mezcla: "mezcla", nuevos: "productos nuevos", descontinuados: "productos que dejaron de venderse", sin_volumen: "ajustes sin kg" } as const;
const kgTxt = (kg: number) => `${conteo(kg)} kg`;

/** S23: renglones que suman la variación al centavo, con el producto que más pesa en precio y en mezcla. */
function puente(p: Puente, periodo: Periodo, comparado: Periodo, sufijo: string): Pick<Resultado, "calculo" | "datos" | "resumen" | "hechos" | "visual"> {
  const pasos = pasosPuente(p, periodo, comparado);
  const principal = efectoPrincipal(p);
  const pp = p.detalle_precio[0], pm = p.detalle_mezcla[0];
  const fmt = (d: Puente["detalle_precio"][number]) => ({
    producto: `${d.descripcion} (${d.art_codigo})`, precio_kg: precioKg(d.precio_kg), precio_kg_anterior: precioKg(d.precio_kg_cmp),
    kg: kgTxt(d.kg), kg_anterior: kgTxt(d.kg_cmp), efecto_precio: lempirasSigno(d.efecto_precio), efecto_mezcla: lempirasSigno(d.efecto_mezcla),
  });
  const hechos = [
    `La variación de venta neta ${rango(periodo, comparado)} fue ${lempirasSigno(p.variacion)} (${lempirasCompacto(p.venta_neta)} vs. ${lempirasCompacto(p.venta_neta_cmp)}${sufijo}) y se reparte así: ${pasos.map((x) => `${EFECTO_TXT[x.clave]} ${lempirasSigno(x.valor)}`).join(", ")}.`,
    `El efecto que más pesa es el de ${EFECTO_TXT[principal]} (${lempirasSigno(p[principal])}). En los ${conteo(p.productos_comparables)} productos que vendieron en ambos meses, el precio promedio pasó de ${precioKg(p.precio_kg_comparables_cmp)}/kg a ${precioKg(p.precio_kg_comparables)}/kg y el volumen de ${toneladas(p.kg_comparables_cmp)} t a ${toneladas(p.kg_comparables)} t.`,
  ];
  if (pp) hechos.push(`Mayor efecto precio: ${pp.descripcion} (${lempirasSigno(pp.efecto_precio)}; de ${precioKg(pp.precio_kg_cmp)}/kg a ${precioKg(pp.precio_kg)}/kg).`);
  if (pm) hechos.push(`Mayor efecto mezcla: ${pm.descripcion} (${lempirasSigno(pm.efecto_mezcla)}; de ${kgTxt(pm.kg_cmp)} a ${kgTxt(pm.kg)}).`);
  return {
    calculo: "ventas.puente_precio_volumen_mezcla", datos: p,
    resumen: {
      variacion_total: lempirasSigno(p.variacion), venta_neta: lempirasCompacto(p.venta_neta), venta_neta_anterior: lempirasCompacto(p.venta_neta_cmp),
      efectos: pasos.map((x) => ({ efecto: x.nombre, valor: lempirasSigno(x.valor), que_mide: x.explicacion })),
      productos_comparables: conteo(p.productos_comparables),
      precio_kg_comparables: { actual: precioKg(p.precio_kg_comparables), anterior: precioKg(p.precio_kg_comparables_cmp) },
      mayor_efecto_precio: p.detalle_precio.map(fmt), mayor_efecto_mezcla: p.detalle_mezcla.map(fmt),
      principales_nuevos: p.principales_nuevos.map((x) => ({ producto: `${x.descripcion} (${x.art_codigo})`, venta_neta: lempirasSigno(x.variacion) })),
      principales_descontinuados: p.principales_descontinuados.map((x) => ({ producto: `${x.descripcion} (${x.art_codigo})`, venta_neta_perdida: lempirasSigno(x.variacion) })),
    },
    hechos,
    visual: {
      tipo: "tabla", titulo: `Precio, volumen y mezcla · ${rango(periodo, comparado)}`, columnas: ["Renglón", "Lempiras", "Qué mide"],
      filas: [...pasos.map((x) => [x.nombre, lempirasSigno(x.valor), x.explicacion]), ["Variación total", lempirasSigno(p.variacion), "Suma de los renglones, al centavo."]],
    },
  };
}

/** S24: enero..mes contra el mismo tramo del año anterior. */
function acumulado(id: string, periodo: Periodo, filtros: Filtros, a: Acumulado, ctx: Contexto): Resultado {
  const meta = ctx.version.metadatos;
  const comparado = { anio: periodo.anio - 1, mes: periodo.mes };
  const r1 = rangoAcumulado(a.anio, a.mes), r0 = rangoAcumulado(a.anio - 1, a.mes);
  const sufijo = Object.keys(filtros).length ? `, ${describirFiltros(filtros, meta)}` : "";
  const pctPrecio = a.precio_kg === null || a.precio_kg_cmp === null ? "sin base" : pctTexto(a.precio_kg, a.precio_kg_cmp);
  const filas: [string, string, string, string][] = [
    ["Venta neta", lempirasCompacto(a.venta_neta), lempirasCompacto(a.venta_neta_cmp), pctTexto(a.venta_neta, a.venta_neta_cmp)],
    ["Volumen (t)", toneladas(a.kg), toneladas(a.kg_cmp), pctTexto(a.kg, a.kg_cmp)],
    ["Precio promedio (L/kg)", precioKg(a.precio_kg), precioKg(a.precio_kg_cmp), pctPrecio],
    ["Clientes con compra", conteo(a.clientes_con_compra), conteo(a.clientes_con_compra_cmp), pctTexto(a.clientes_con_compra, a.clientes_con_compra_cmp)],
  ];
  const dif = a.venta_neta - a.venta_neta_cmp;
  const avisos = advertenciasAcumulado(a, meta.periodos);
  return {
    id, herramienta: "acumulado_anio", argumentos: { periodo: `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`, filtros },
    calculo: "ventas.acumulado_anio", periodo, comparado, filtros, datos: a,
    resumen: {
      tramo: r1, comparado_con: r0, diferencia_venta_neta: lempirasSigno(dif),
      indicadores: filas.map(([indicador, actual, anterior, variacion]) => ({ indicador, actual, anterior, variacion })),
      advertencias: avisos,
    },
    hechos: [
      `Acumulado ${r1}: venta neta ${lempirasCompacto(a.venta_neta)} vs. ${lempirasCompacto(a.venta_neta_cmp)} en ${r0} (${lempirasSigno(dif)}, ${pctTexto(a.venta_neta, a.venta_neta_cmp)}${sufijo}).`,
      `Volumen ${toneladas(a.kg)} t vs. ${toneladas(a.kg_cmp)} t (${pctTexto(a.kg, a.kg_cmp)}); precio promedio ${precioKg(a.precio_kg)}/kg vs. ${precioKg(a.precio_kg_cmp)}/kg (${pctPrecio}); clientes con compra en el tramo ${conteo(a.clientes_con_compra)} vs. ${conteo(a.clientes_con_compra_cmp)} (${pctTexto(a.clientes_con_compra, a.clientes_con_compra_cmp)}).`,
      ...avisos,
    ],
    visual: { tipo: "tabla", titulo: `Acumulado del año · ${r1} vs. ${r0}`, columnas: ["Indicador", capital(r1), capital(r0), "Variación"], filas },
  };
}

/** S25: rutas cuyo cambio contra el mes anterior se sale de su historia de 12 meses. */
function rutasAtipicas(id: string, periodo: Periodo, filtros: Filtros, limite: number, r: RutasAtipicas, ctx: Contexto): Resultado {
  const meta = ctx.version.metadatos;
  const anterior = mesAnterior(periodo);
  const sufijo = Object.keys(filtros).length ? ` (${describirFiltros(filtros, meta)})` : "";
  const hechos = !r.hay_anterior
    ? [`${capital(periodoLargo(anterior))} no tiene datos en esta versión: no hay contra qué comparar las rutas de ${periodoLargo(periodo)}.`]
    : !r.rutas.length
      ? [`Ninguna de las ${conteo(r.rutas_evaluadas)} rutas evaluadas se salió de lo normal en ${periodoLargo(periodo)} contra ${periodoLargo(anterior)}${sufijo}.`]
      : [
        `En ${periodoLargo(periodo)}, ${conteo(r.rutas_fuera)} de ${conteo(r.rutas_evaluadas)} rutas evaluadas se salieron de lo normal contra ${periodoLargo(anterior)}${sufijo}.`,
        ...r.rutas.slice(0, 3).map((x) => `${x.ruta} (${x.canal}): ${motivoAtipica(x, anterior)}`),
      ];
  return {
    id, herramienta: "rutas_atipicas", argumentos: { periodo: `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`, filtros, limite },
    calculo: "ventas.rutas_atipicas", periodo, comparado: anterior, filtros, datos: r,
    resumen: {
      criterio: "Cambio del mes contra el mes anterior frente a los cambios de mes a mes de los 12 meses anteriores de la misma ruta (mediana y desviación robusta); se excluyen rutas chicas y rutas con menos de 6 meses de historia.",
      rutas_evaluadas: conteo(r.rutas_evaluadas), rutas_fuera_de_lo_normal: conteo(r.rutas_fuera),
      rutas_chicas_excluidas: conteo(r.rutas_pequenas), rutas_sin_historia: conteo(r.rutas_sin_historia),
      rutas: r.rutas.map((x) => {
        const { bajo, alto } = rangoNormal(x);
        return {
          ruta: x.ruta, canal: x.canal, actual: lempirasCompacto(x.actual), anterior: lempirasCompacto(x.anterior), variacion: lempirasSigno(x.variacion),
          cambio: fraccionSigno(x.cambio), rango_normal: `${fraccionSigno(bajo)} a ${fraccionSigno(alto)}`, motivo: motivoAtipica(x, anterior),
        };
      }),
    },
    hechos,
    visual: {
      tipo: "tabla", titulo: `Rutas fuera de lo normal · ${rango(periodo, anterior)}`,
      columnas: ["Ruta", "Canal", capital(periodoCorto(periodo)), capital(periodoCorto(anterior)), "Cambio", "Lo normal"],
      filas: r.rutas.map((x) => {
        const { bajo, alto } = rangoNormal(x);
        return [x.ruta, x.canal, lempirasCompacto(x.actual), lempirasCompacto(x.anterior), fraccionSigno(x.cambio), `${fraccionSigno(bajo)} a ${fraccionSigno(alto)}`];
      }),
    },
  };
}

function periodoValido(s: string, meta: VersionVigente["metadatos"]): Periodo {
  const p = leerPeriodo(s);
  if (!p) throw new ErrorHerramienta(`periodo inválido "${s}": usar AAAA-MM`);
  if (!meta.periodos.some((m) => m.anio === p.anio && m.mes === p.mes)) {
    const [a, z_] = [meta.periodos[0], meta.periodos.at(-1)!];
    throw new ErrorHerramienta(`${periodoLargo(p)} no tiene datos en esta versión; hay de ${periodoLargo(a)} a ${periodoLargo(z_)}`);
  }
  return p;
}

/** Lleva cada filtro a su valor canónico en la versión (sin distinguir tildes ni mayúsculas) o falla con sugerencias. */
export function resolverFiltros(f: z.infer<typeof FiltrosArg> & object, meta: VersionVigente["metadatos"]): Filtros {
  const out: Filtros = {};
  if (f.empresa) out.empresa = elegir("empresa", f.empresa, ["MCM", "GKSA"]);
  if (f.canal) out.canal = elegir("canal", f.canal, meta.canal);
  if (f.marca) out.marca = elegir("marca", f.marca, meta.marca);
  if (f.ruta) out.ruta = elegir("ruta", f.ruta, meta.ruta, (r) => [r, r.split(" - ").slice(1).join(" - "), r.split(" - ")[0]]);
  if (f.producto) {
    const desc = meta.producto.map((p) => p.descripcion);
    const porCodigo = meta.producto.find((p) => p.codigo === f.producto!.trim());
    out.art_codigo = porCodigo?.codigo ?? meta.producto[desc.indexOf(elegir("producto", f.producto, desc))].codigo;
  }
  return out;
}

function elegir(campo: string, valor: string, opciones: string[], variantes: (o: string) => string[] = (o) => [o]): string {
  const v = normalizar(valor);
  const exacta = opciones.find((o) => variantes(o).some((x) => normalizar(x) === v));
  if (exacta) return exacta;
  const parciales = opciones.filter((o) => normalizar(o).includes(v));
  if (parciales.length === 1) return parciales[0];
  const sug = parciales.length ? ` Coincidencias: ${parciales.slice(0, 5).join(", ")}.` : "";
  throw new ErrorHerramienta(`${campo} "${valor}" no existe en la versión publicada.${sug}`);
}
