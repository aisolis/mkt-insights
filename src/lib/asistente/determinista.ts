/**
 * Modo determinista: interpreta la pregunta con reglas, arma un plan con las mismas herramientas que usa el modelo
 * y redacta con plantillas. Es la respuesta cuando no hay modelo configurado o el modelo falla, y la base contra
 * la que se prueba el banco de preguntas.
 */
import { lempirasCompacto, periodoLargo } from "@/lib/format";
import { efectoPrincipal, pasosPuente } from "@/lib/dashboard/analisis";
import { periodoComparado } from "@/lib/dashboard/params";
import type { Descomposicion, Dimension, Kpi, Periodo, Puente, RutasAtipicas, VariacionFila } from "@/lib/semantic/contracts";
import { lempirasSigno, normalizar, participacion, pctTexto, periodoTxt } from "./texto";
import type { Contexto, Resultado } from "./tipos";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export type FiltrosPregunta = { canal?: string; ruta?: string; marca?: string; producto?: string; empresa?: string };
export type Plan = {
  /** G9: "puente" = precio, volumen y mezcla; "acumulado" = en lo que va del año; "atipicas" = rutas fuera de lo normal. */
  tipo: "diagnostico" | "dimension" | "kpi" | "serie" | "puente" | "acumulado" | "atipicas";
  periodo: Periodo;
  comparado: Periodo;
  filtros: FiltrosPregunta;
  dimensiones: Dimension[];
  descomponer: boolean;
};

const DIMENSIONES: [Dimension, RegExp][] = [
  ["canal", /\bcanal(es)?\b/],
  ["ruta", /\b(rutas?|territorios?)\b/],
  ["marca", /\bmarcas?\b/],
  ["art_codigo", /\b(productos?|articulos?|skus?|presentacion(es)?)\b/],
  ["zona", /\bzonas?\b/],
  ["sucursal", /\bsucursal(es)?\b/],
  ["categoria", /\b(categorias?|cafe (vs\.?|y|o) rep)\b/],
  ["empresa", /\bempresas?\b/],
];

export function interpretar(pregunta: string, ctx: Contexto): Plan {
  const meta = ctx.version.metadatos;
  let t = ` ${normalizar(pregunta).replace(/[¿?¡!,;:()"]/g, " ").replace(/\s+/g, " ")} `;

  // Filtros: parten de los heredados del dashboard; lo que nombra la pregunta los reemplaza.
  const heredados = ctx.estado.filtros;
  const filtros: FiltrosPregunta = { canal: heredados.canal, ruta: heredados.ruta, marca: heredados.marca, producto: heredados.art_codigo, empresa: heredados.empresa };
  const quitar = (frase: string) => { t = t.replace(frase, " "); };

  for (const c of meta.canal) {
    const n = normalizar(c);
    const conPrefijo = new RegExp(` canal(es)? (de )?${n} `);
    const suelto = n !== "detalle" && n !== "sin canal" && new RegExp(` ${n} `).test(t);
    const detalle = n === "detalle" && /\b(en|de|del|al) Detalle\b/.test(pregunta);
    const m = conPrefijo.exec(t);
    if (m || suelto || detalle) { filtros.canal = c; quitar(m ? m[0] : ` ${n} `); }
  }
  const marcas = [...meta.marca].sort((a, b) => b.length - a.length);
  for (const mca of marcas) {
    const n = normalizar(mca);
    const conPrefijo = new RegExp(` marca ${escapar(n)} `).exec(t);
    const literal = new RegExp(`(^|[^\\p{L}])${escapar(mca)}([^\\p{L}]|$)`, "u").test(pregunta) && t.includes(` ${n} `);
    if (conPrefijo || literal) { filtros.marca = mca; quitar(conPrefijo ? conPrefijo[0] : ` ${n} `); break; }
  }
  const rutaCodigo = / ruta (\d{2,4}) /.exec(t);
  const ruta = rutaCodigo
    ? meta.ruta.find((r) => r.startsWith(`${rutaCodigo[1]} - `))
    : meta.ruta.find((r) => { const nombre = normalizar(r.split(" - ").slice(1).join(" - ")); return nombre.length >= 6 && t.includes(` ${nombre} `); });
  if (ruta) { filtros.ruta = ruta; if (rutaCodigo) quitar(rutaCodigo[0]); else quitar(` ${normalizar(ruta.split(" - ").slice(1).join(" - "))} `); }
  const empresa = / (mcm|gksa) /.exec(t);
  if (empresa) { filtros.empresa = empresa[1].toUpperCase(); quitar(empresa[0]); }

  // Periodo: "septiembre 2026", "septiembre" (el más reciente con datos); un segundo mes es el comparado,
  // igual que un mes precedido de "vs.", "contra", "frente a"… aunque sea el único que se nombra.
  const nombrados: (Periodo & { contra: boolean })[] = [];
  const reMes = new RegExp(`(\\b(?:vs\\.?|versus|contra|frente a|respecto a|comparado con) (?:el |la )?(?:mes de )?)?\\b(${MESES.join("|")}|setiembre)( (de )?(\\d{4}))?`, "g");
  for (const m of t.matchAll(reMes)) {
    const mes = m[2] === "setiembre" ? 9 : MESES.indexOf(m[2]) + 1;
    const anio = m[5] ? +m[5] : meta.periodos.findLast((p) => p.mes === mes)?.anio;
    if (anio) nombrados.push({ anio, mes, contra: !!m[1] });
  }
  const [mesPeriodo, otroMes] = nombrados.filter((n) => !n.contra);
  const mesComparado = nombrados.find((n) => n.contra) ?? otroMes;
  const anioSuelto = /\b(20\d{2})\b/.exec(t.replace(reMes, " "));
  const periodo: Periodo = mesPeriodo ? { anio: mesPeriodo.anio, mes: mesPeriodo.mes } : ctx.estado.periodo;
  const interanual = /\b(ano anterior|ano pasado|interanual|mismo mes)\b/.test(t) || (!!anioSuelto && +anioSuelto[1] === periodo.anio - 1);
  const mesAnterior = /\bmes anterior\b/.test(t);
  const comparar = interanual ? "anio" : mesAnterior ? "anterior" : ctx.estado.comparar;
  const comparado: Periodo = mesComparado ? { anio: mesComparado.anio, mes: mesComparado.mes } : periodoComparado(periodo, comparar);

  const dimensiones = DIMENSIONES.filter(([, re]) => re.test(t)).map(([d]) => d);
  const descomponer = /\b(facturas?|ticket|frecuencia|clientes?)\b/.test(t);
  const causal = /\b(donde|por que|porque|concentr\w*|explic\w*|contribu\w*|caida|cayo|cae|baj\w*|crec\w*|subi\w*|sube|aument\w*|disminu\w*|variacion|paso|fall\w*|mejor\w*|peor\w*)\b/.test(t);

  // G9: acumulado del año, rutas fuera de lo normal y precio–volumen–mezcla van antes que las demás lecturas.
  const acumulado = /\b(en lo que va del? ano|lo que va del? ano|acumulad[oa]s?|ytd|year to date|(en el |del )?ano a la fecha|de enero a la fecha)\b/.test(t);
  const atipicas = /\b(fuera de lo (normal|comun|habitual)|atipic\w*|anomal\w*|anormal\w*|inusual\w*|se salieron de lo normal)\b/.test(t);
  const puente = /\b(mezcla|mix|pvm|efecto (de )?(precio|volumen|mezcla)|(precio|volumen) (y|o|vs\.?|versus|contra) (precio|volumen))\b/.test(t)
    || (causal && /\bprecios?\b/.test(t));

  let tipo: Plan["tipo"];
  if (acumulado) tipo = "acumulado";
  else if (atipicas) tipo = "atipicas";
  else if (puente) tipo = "puente";
  else if (/\b(tendencia|evolucion|mes a mes|serie|historic\w*|mensual|por mes|en el ano|durante el ano|ultimos meses)\b/.test(t) && !causal) tipo = "serie";
  else if (dimensiones.length) tipo = "dimension";
  else if (!causal && /\b(cuant[oa]s?|cual (fue|es)|total|resumen|kpi|indicadores)\b/.test(t)) tipo = "kpi";
  else tipo = "diagnostico";

  // Una pregunta de serie que nombra un año usa ese año.
  const periodoSerie = tipo === "serie" && anioSuelto && !nombrados.length ? { anio: +anioSuelto[1], mes: 12 } : periodo;
  // Un acumulado que nombra solo el año ("acumulado 2025") llega hasta el último mes con datos de ese año.
  const ultimoDelAnio = anioSuelto && meta.periodos.findLast((p) => p.anio === +anioSuelto[1]);
  const periodoAcumulado = tipo === "acumulado" && ultimoDelAnio && !nombrados.length ? { anio: ultimoDelAnio.anio, mes: ultimoDelAnio.mes } : periodoSerie;
  return { tipo, periodo: periodoAcumulado, comparado, filtros: limpiar(filtros), dimensiones, descomponer };
}

/** Ejecuta el plan con el catálogo de herramientas. Devuelve llamadas en orden: la primera es siempre la principal. */
export function llamadas(plan: Plan): { herramienta: string; args: Record<string, unknown> }[] {
  const base = { periodo: periodoTxt(plan.periodo), comparado: periodoTxt(plan.comparado), filtros: plan.filtros };
  if (plan.tipo === "serie") return [{ herramienta: "serie_mensual", args: { anio: plan.periodo.anio, filtros: plan.filtros } }];
  if (plan.tipo === "acumulado") return [{ herramienta: "acumulado_anio", args: { periodo: base.periodo, filtros: plan.filtros } }];
  if (plan.tipo === "atipicas") return [{ herramienta: "rutas_atipicas", args: { periodo: base.periodo, filtros: plan.filtros, limite: 10 } }];
  const out = [{ herramienta: "kpi_periodo", args: base }];
  if (plan.tipo === "puente") {
    out.push({ herramienta: "puente_precio_volumen_mezcla", args: base });
    for (const d of plan.dimensiones) {
      if (d === "ruta") out.push({ herramienta: "top_rutas", args: { ...base, limite: 10 } as never });
      else if (!(d === "canal" && plan.filtros.canal) && !(d === "marca" && plan.filtros.marca)) out.push({ herramienta: "variacion_por_dimension", args: { ...base, dimension: d } as never });
    }
    return out;
  }
  const dims: Dimension[] = plan.tipo === "diagnostico" ? ["canal", "ruta", "marca"] : plan.tipo === "dimension" ? plan.dimensiones : [];
  for (const d of dims) {
    if (d === "ruta") out.push({ herramienta: "top_rutas", args: { ...base, limite: 10 } as never });
    else if (!(d === "canal" && plan.filtros.canal) && !(d === "marca" && plan.filtros.marca)) out.push({ herramienta: "variacion_por_dimension", args: { ...base, dimension: d } as never });
  }
  if (plan.tipo === "diagnostico" || plan.descomponer) out.splice(1, 0, { herramienta: "descomposicion", args: base });
  return out;
}

/** Texto corto a partir de los datos de las consultas. */
export function redactar(resultados: Resultado[], plan: Plan): string {
  const frases: string[] = [];
  const kpi = resultados.find((r) => r.herramienta === "kpi_periodo");
  if (kpi) {
    const k = kpi.datos as Kpi;
    const dif = k.venta_neta - k.venta_neta_cmp;
    const verbo = dif < 0 ? "cayó" : dif > 0 ? "subió" : "se mantuvo";
    frases.push(`En ${periodoLargo(kpi.periodo!)} la venta neta ${verbo} ${pctTexto(k.venta_neta, k.venta_neta_cmp).replace(/^[+−]/, "")} vs. ${periodoLargo(kpi.comparado!)} (${lempirasSigno(dif)}): ${lempirasCompacto(k.venta_neta)} contra ${lempirasCompacto(k.venta_neta_cmp)}.`);
  }
  const sentido = kpi ? Math.sign((kpi.datos as Kpi).venta_neta - (kpi.datos as Kpi).venta_neta_cmp) : -1;
  const partes: string[] = [];
  for (const r of resultados) {
    if (r.herramienta === "variacion_por_dimension") {
      const filas = r.datos as VariacionFila[];
      const total = filas.reduce((s, f) => s + f.variacion, 0);
      const lider = sentido < 0 ? filas[0] : filas.at(-1);
      if (lider && Math.sign(lider.variacion) === Math.sign(total) && total !== 0) {
        const part = participacion(lider.variacion, total);
        partes.push(`por ${etiqueta(r.argumentos.dimension as Dimension)} en ${lider.valor} (${lempirasSigno(lider.variacion)}${part ? `, ${part} de la variación` : ""})`);
      }
    }
    if (r.herramienta === "top_rutas") {
      const [r1] = r.datos as { ruta: string; canal: string; variacion: number }[];
      if (r1) partes.push(`por ruta en ${r1.ruta} de ${r1.canal} (${lempirasSigno(r1.variacion)})`);
    }
  }
  if (partes.length) frases.push(`${sentido < 0 ? "La caída" : "El aumento"} se concentra ${partes.join("; ")}.`);
  const desc = resultados.find((r) => r.herramienta === "descomposicion");
  if (desc) frases.push(desc.hechos[0]);
  // G9
  const pvm = resultados.find((r) => r.herramienta === "puente_precio_volumen_mezcla");
  if (pvm) {
    const p = pvm.datos as Puente;
    const pasos = pasosPuente(p, pvm.periodo!, pvm.comparado!);
    const principal = pasos.find((x) => x.clave === efectoPrincipal(p))!;
    frases.push(`Por precio, volumen y mezcla: ${pasos.map((x) => `${x.nombre.toLowerCase()} ${lempirasSigno(x.valor)}`).join(", ")}; lo que más pesa es ${principal.nombre.toLowerCase()} (${lempirasSigno(principal.valor)}).`);
    if (pvm.hechos[2]) frases.push(pvm.hechos[2]);
  }
  const acu = resultados.find((r) => r.herramienta === "acumulado_anio");
  if (acu) frases.push(...acu.hechos.slice(0, 2));
  const atip = resultados.find((r) => r.herramienta === "rutas_atipicas");
  if (atip) {
    frases.push(atip.hechos[0]);
    if ((atip.datos as RutasAtipicas).rutas.length) frases.push(`La que más se aleja es ${atip.hechos[1]}`);
  }
  const serie = resultados.find((r) => r.herramienta === "serie_mensual");
  if (serie) frases.push(...serie.hechos);
  if (!frases.length) frases.push(`No encontré datos para ${periodoLargo(plan.periodo)} con esos filtros.`);
  return frases.join(" ");
}

/** Hipótesis a validar: posibles causas que los datos de venta no prueban. Sin cifras. */
export function hipotesis(resultados: Resultado[], plan: Plan): string[] {
  const kpi = resultados.find((r) => r.herramienta === "kpi_periodo")?.datos as Kpi | undefined;
  const desc = resultados.find((r) => r.herramienta === "descomposicion")?.datos as Descomposicion | undefined;
  const out: string[] = hipotesisAnalisis(resultados);
  if (!kpi) return out;
  const cae = kpi.venta_neta < kpi.venta_neta_cmp;
  const rel = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? 0 : a / b - 1);
  if (desc) {
    const dTicket = rel(desc.actual.ticket_factura, desc.anterior.ticket_factura);
    const dFact = rel(desc.actual.facturas, desc.anterior.facturas);
    const dCli = rel(desc.actual.clientes, desc.anterior.clientes);
    const dKg = rel(kpi.kg, kpi.kg_cmp), dPrecio = rel(kpi.precio_kg, kpi.precio_kg_cmp);
    if (cae && Math.abs(dTicket) > Math.abs(dFact)) {
      out.push(dKg < 0 && dPrecio >= 0
        ? "Compras más chicas con precio estable o al alza: posible falta de producto en ruta, menor rotación en el punto de venta o compras adelantadas en el mes anterior."
        : "Cambio de mezcla hacia presentaciones o productos de menor precio, o más descuento por factura.");
    }
    if (cae && dFact < 0 && Math.abs(dFact) >= Math.abs(dTicket)) out.push("Menor frecuencia de compra: podría deberse a menos visitas o a rutas sin atender; el cubo no registra visitas.");
    if (cae && dCli < 0) out.push("Clientes que dejaron de comprar en el periodo: revisar si se concentran en pocas rutas antes de concluir.");
    if (!cae && dCli > 0) out.push("Más clientes activos: puede reflejar apertura de clientes o recuperación de inactivos; validar con el equipo comercial.");
  }
  if (plan.comparado.anio === plan.periodo.anio && plan.comparado.mes === plan.periodo.mes - 1)
    out.push("Estacionalidad: compararlo con el mismo mes del año anterior antes de atribuirlo a la operación.");
  return out;
}

/** G9: posibles causas según el puente y las rutas fuera de lo normal. Sin cifras. */
function hipotesisAnalisis(resultados: Resultado[]): string[] {
  const out: string[] = [];
  const p = resultados.find((r) => r.herramienta === "puente_precio_volumen_mezcla")?.datos as Puente | undefined;
  if (p && p.variacion !== 0) {
    const principal = efectoPrincipal(p);
    const pesa = (v: number) => Math.abs(v) > Math.abs(p.variacion) / 4;
    if (principal === "volumen" && p.volumen < 0) out.push("La caída es sobre todo de kilos: revisar abastecimiento en ruta, cobertura de clientes o compras adelantadas en el mes anterior.");
    if (p.precio < 0 && (principal === "precio" || pesa(p.precio))) out.push("Precio por kg a la baja: revisar descuentos, promociones o cambios en la lista de precios del periodo.");
    if (p.mezcla < 0 && (principal === "mezcla" || pesa(p.mezcla))) out.push("La mezcla se movió hacia productos de menor precio por kg: revisar presentaciones económicas o falta de productos de mayor valor.");
    if (p.descontinuados < 0 && pesa(p.descontinuados)) out.push("Productos que dejaron de venderse: confirmar si fue una salida planeada, un cambio de código o falta de producto.");
  }
  const atip = resultados.find((r) => r.herramienta === "rutas_atipicas")?.datos as RutasAtipicas | undefined;
  if (atip?.rutas.length) out.push("Una ruta fuera de lo normal puede deberse a un pedido grande puntual, un cambio de vendedor o de territorio, o a un cambio de canal: validarlo con el supervisor antes de concluir.");
  return out;
}

const etiqueta = (d: Dimension) => ({ canal: "canal", ruta: "ruta", zona: "zona", sucursal: "sucursal", marca: "marca", categoria: "categoría", art_codigo: "producto", empresa: "empresa" })[d];
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function limpiar(f: FiltrosPregunta): FiltrosPregunta {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as FiltrosPregunta;
}
