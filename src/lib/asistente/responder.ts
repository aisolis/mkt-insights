/**
 * Punto de entrada del asistente: alcance → modelo (si hay) o modo determinista → evidencia.
 * Los hechos siempre se redactan desde las consultas; del modelo solo se toma la lectura y las hipótesis,
 * y solo si todas sus cifras salen de las consultas.
 */
import { advertencias, S1_SIN_CERTIFICAR_HASTA } from "@/lib/dashboard/params";
import { fechaCorta, periodoLargo } from "@/lib/format";
import type { Kpi } from "@/lib/semantic/contracts";
import { fueraDeAlcance } from "./alcance";
import { hipotesis, interpretar, llamadas, redactar } from "./determinista";
import { ErrorHerramienta, ejecutar } from "./herramientas";
import { preguntarAlModelo, type ConfigModelo } from "./modelo";
import { describirFiltros, periodoTxt, rango } from "./texto";
import type { Contexto, Evidencia, Resultado, Respuesta, Turno } from "./tipos";
import { cifrasNoVerificadas, cifrasPermitidas } from "./verificar";

export async function responder(pregunta: string, historial: Turno[], ctx: Contexto, modelo: ConfigModelo | null): Promise<Respuesta> {
  const motivo = fueraDeAlcance(pregunta);
  if (motivo) {
    return {
      estado: "fuera_de_alcance", modo: "determinista", texto: `No puedo responder eso. ${motivo}`, hechos: [], hipotesis: [], visuales: [],
      evidencia: evidencia([], ctx, []), consultas: [],
    };
  }

  if (modelo) {
    try {
      const salida = await preguntarAlModelo(pregunta, historial, ctx, modelo);
      if (salida.resultados.length) {
        const resultados = await conKpi(salida.resultados, ctx);
        const permitidas = cifrasPermitidas(resultados.flatMap((r) => [r.resumen, r.hechos]));
        const malas = cifrasNoVerificadas([salida.texto, ...salida.hipotesis].join(" "), permitidas);
        const avisos: string[] = [];
        let texto = salida.texto;
        let hips = salida.hipotesis;
        if (malas.length || !texto) {
          avisos.push(malas.length
            ? `El texto del modelo traía cifras que no salen de las consultas (${malas.join(", ")}); se muestra la redacción automática.`
            : "El modelo no devolvió texto; se muestra la redacción automática.");
          texto = redactar(resultados, planDe(resultados, ctx));
          hips = cifrasNoVerificadas(hips.join(" "), permitidas).length ? [] : hips;
        }
        const elegidos = salida.visuales.map((id) => resultados.find((r) => r.id === id)).filter((r): r is Resultado => !!r?.visual);
        return armar("modelo", texto, hips, elegidos.length ? elegidos : resultados, resultados, ctx, avisos);
      }
      // El modelo respondió sin consultar: no hay cifras que mostrar; si escribió alguna, no se muestra.
      if (!cifrasNoVerificadas(salida.texto, new Set()).length && salida.texto)
        return armar("modelo", salida.texto, salida.hipotesis, [], [], ctx, []);
    } catch (e) {
      console.error("asistente: el modelo falló, se responde en modo determinista", e);
      return determinista(pregunta, ctx, ["El modelo no respondió; se muestra el análisis automático."]);
    }
  }
  return determinista(pregunta, ctx, []);
}

async function determinista(pregunta: string, ctx: Contexto, avisos: string[]): Promise<Respuesta> {
  const plan = interpretar(pregunta, ctx);
  const resultados: Resultado[] = [];
  try {
    for (const [i, l] of llamadas(plan).entries()) resultados.push(await ejecutar(l.herramienta, l.args, ctx, `c${i + 1}`));
  } catch (e) {
    if (!(e instanceof ErrorHerramienta)) throw e;
    return { ...armar("determinista", `No pude consultar eso: ${e.message}`, [], [], resultados, ctx, avisos), estado: "sin_datos" };
  }
  return armar("determinista", redactar(resultados, plan), hipotesis(resultados, plan), resultados, resultados, ctx, avisos);
}

/** La cobertura de la evidencia sale de kpi_periodo del periodo principal; si el modelo no la pidió, se agrega. */
async function conKpi(resultados: Resultado[], ctx: Contexto) {
  const principal = resultados.find((r) => r.periodo);
  if (!principal || resultados.some((r) => r.herramienta === "kpi_periodo")) return resultados;
  const k = await ejecutar("kpi_periodo", { periodo: periodoTxt(principal.periodo!), comparado: periodoTxt(principal.comparado!), filtros: principal.argumentos.filtros }, ctx, `c${resultados.length + 1}`)
    .catch(() => null);
  return k ? [...resultados, k] : resultados;
}

function planDe(resultados: Resultado[], ctx: Contexto) {
  const r = resultados.find((x) => x.periodo);
  return { ...interpretar("", ctx), ...(r ? { periodo: r.periodo!, comparado: r.comparado! } : {}) };
}

function armar(modo: Respuesta["modo"], texto: string, hips: string[], visibles: Resultado[], resultados: Resultado[], ctx: Contexto, avisos: string[]): Respuesta {
  return {
    estado: "ok", modo, texto,
    hechos: resultados.flatMap((r) => r.hechos),
    hipotesis: hips,
    visuales: visibles.flatMap((r) => (r.visual ? [r.visual] : [])).slice(0, 3),
    evidencia: evidencia(resultados, ctx, avisos),
    consultas: resultados.map(({ id, herramienta, argumentos, calculo, periodo, comparado, filtros, datos }) => ({ id, herramienta, argumentos, calculo, periodo, comparado, filtros, datos })),
  };
}

function evidencia(resultados: Resultado[], ctx: Contexto, avisos: string[]): Evidencia {
  const { version, estado } = ctx;
  const meta = version.metadatos;
  const principal = resultados.find((r) => r.periodo);
  const kpi = resultados.find((r) => r.herramienta === "kpi_periodo")?.datos as Kpi | undefined;
  const periodo = principal?.periodo ?? estado.periodo;
  const serie = resultados.find((r) => r.herramienta === "serie_mensual");
  const adv = principal ? advertencias(periodo, principal.comparado!, meta.periodos) : [];
  if (!principal && serie) {
    const anio = Number(serie.argumentos.anio);
    if (!meta.periodos.some((p) => p.anio === anio - 1)) adv.push(`${anio - 1} no tiene datos en esta versión: la línea del año anterior queda vacía.`);
    if (anio - 1 <= S1_SIN_CERTIFICAR_HASTA.anio || anio <= S1_SIN_CERTIFICAR_HASTA.anio)
      adv.push(`Los meses hasta ${periodoLargo(S1_SIN_CERTIFICAR_HASTA)} están sin certificar: la hoja ene-2025–ago-2026 puede estar truncada (S1).`);
    if (meta.periodos.some((p) => p.anio === anio && !p.cerrado)) adv.push("El último mes de la serie es parcial.");
  }
  if (!version.conciliada_bi) adv.push("Cifras verificadas contra el Excel exportado, todavía no conciliadas con el reporte de BI.");
  return {
    fuente: `Cubo de ventas BIA · ${version.archivo}`,
    version: version.version,
    fecha_corte: fechaCorta(version.fecha_corte),
    conciliada_bi: version.conciliada_bi,
    periodo: principal ? rango(periodo, principal.comparado!) : serie ? `año ${serie.argumentos.anio} vs. ${Number(serie.argumentos.anio) - 1}` : periodoLargo(periodo),
    filtros: describirFiltros(principal?.filtros ?? serie?.filtros ?? estado.filtros, meta),
    cobertura: kpi ? `${kpi.rutas_con_venta}/${kpi.rutas_total} rutas con venta en el periodo` : null,
    calculo: [...new Set(resultados.map((r) => r.calculo))],
    advertencias: [...avisos, ...adv],
  };
}
