/**
 * Punto de entrada del asistente: alcance → modelo (si hay) o modo determinista → evidencia.
 * Los hechos siempre se redactan desde las consultas; del modelo solo se toma la lectura y las hipótesis,
 * y solo si todas sus cifras salen de las consultas o de los documentos que citó.
 * El contexto de documentos autorizados (G6) va aparte de los hechos, con documento y página.
 */
import { elegirCitas, type Cita } from "@/lib/conocimiento/tipos";
import { advertencias, S1_SIN_CERTIFICAR_HASTA } from "@/lib/dashboard/params";
import { fechaCorta, periodoLargo } from "@/lib/format";
import type { Kpi } from "@/lib/semantic/contracts";
import { reglaFueraDeAlcance } from "./alcance";
import { hipotesis, interpretar, llamadas, redactar } from "./determinista";
import { ErrorHerramienta, ejecutar } from "./herramientas";
import { preguntarAlModelo, type ConfigModelo } from "./modelo";
import { describirFiltros, periodoTxt, rango } from "./texto";
import type { Contexto, Evidencia, Resultado, Respuesta, Turno } from "./tipos";
import { cifrasNoVerificadas, cifrasPermitidas } from "./verificar";

export async function responder(pregunta: string, historial: Turno[], ctx: Contexto, modelo: ConfigModelo | null): Promise<Respuesta> {
  const regla = reglaFueraDeAlcance(pregunta);
  if (regla) {
    // Sin cifras del cubo. Si el tema lo admite, se muestran los documentos autorizados que hablen de eso.
    const contexto = regla.documentos ? await contextoDocumentos(pregunta, ctx) : [];
    const texto = contexto.length
      ? `Los datos de venta no responden eso: ${regla.motivo} Abajo está lo que dicen los documentos autorizados sobre el tema; es contexto, no cifras del cubo.`
      : `No puedo responder eso. ${regla.motivo}`;
    return {
      estado: "fuera_de_alcance", modo: "determinista", texto, hechos: [], hipotesis: [], visuales: [],
      evidencia: evidencia([], ctx, []), contexto, consultas: [],
    };
  }

  if (modelo) {
    try {
      const salida = await preguntarAlModelo(pregunta, historial, ctx, modelo);
      const citadas = salida.citas.map((id) => salida.documentos.find((d) => d.id === id)).filter((d): d is Cita => !!d);
      if (salida.resultados.length) {
        const resultados = await conKpi(salida.resultados, ctx);
        const permitidas = cifrasPermitidas([...resultados.flatMap((r) => [r.resumen, r.hechos]), ...citadas.map((c) => c.extracto)]);
        const malas = cifrasNoVerificadas([salida.texto, ...salida.hipotesis].join(" "), permitidas);
        const avisos: string[] = [];
        let texto = salida.texto;
        let hips = salida.hipotesis;
        // Si el modelo no buscó en los documentos, se agregan los relevantes; si buscó y no citó, se respeta.
        let contexto = salida.documentos.length ? citadas : await contextoDocumentos(pregunta, ctx);
        if (malas.length || !texto) {
          avisos.push(malas.length
            ? `El texto del modelo traía cifras que no salen de las consultas (${malas.join(", ")}); se muestra la redacción automática.`
            : "El modelo no devolvió texto; se muestra la redacción automática.");
          texto = redactar(resultados, planDe(resultados, ctx));
          hips = cifrasNoVerificadas(hips.join(" "), permitidas).length ? [] : hips;
          contexto = await contextoDocumentos(pregunta, ctx);
        }
        const elegidos = salida.visuales.map((id) => resultados.find((r) => r.id === id)).filter((r): r is Resultado => !!r?.visual);
        return armar("modelo", texto, hips, elegidos.length ? elegidos : resultados, resultados, ctx, avisos, contexto);
      }
      // El modelo respondió sin consultar el cubo: solo vale si no escribió cifras (o si salen de lo que citó).
      if (salida.texto && !cifrasNoVerificadas(salida.texto, cifrasPermitidas(citadas.map((c) => c.extracto))).length)
        return armar("modelo", salida.texto, salida.hipotesis, [], [], ctx, [], citadas);
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
    return { ...armar("determinista", `No pude consultar eso: ${e.message}`, [], [], resultados, ctx, avisos, []), estado: "sin_datos" };
  }
  const contexto = await contextoDocumentos(pregunta, ctx);
  return armar("determinista", redactar(resultados, plan), hipotesis(resultados, plan), resultados, resultados, ctx, avisos, contexto);
}

/** Documentos relevantes para la pregunta. Si la búsqueda falla, la respuesta sigue sin contexto: los datos de
 * venta no dependen de los documentos. */
async function contextoDocumentos(pregunta: string, ctx: Contexto): Promise<Cita[]> {
  if (!ctx.documentos) return [];
  try {
    return elegirCitas(await ctx.documentos(pregunta));
  } catch (e) {
    console.error("asistente: la búsqueda de documentos falló", e);
    return [];
  }
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

function armar(modo: Respuesta["modo"], texto: string, hips: string[], visibles: Resultado[], resultados: Resultado[], ctx: Contexto, avisos: string[], contexto: Cita[]): Respuesta {
  return {
    estado: "ok", modo, texto,
    hechos: resultados.flatMap((r) => r.hechos),
    hipotesis: hips,
    visuales: visibles.flatMap((r) => (r.visual ? [r.visual] : [])).slice(0, 3),
    evidencia: evidencia(resultados, ctx, avisos),
    contexto,
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
      adv.push(`Los meses hasta ${periodoLargo(S1_SIN_CERTIFICAR_HASTA)} están sin certificar, con diferencias menores contra el resumen trimestral que envió BIA: ene–jun 2025 suma L 415 mil más ahí (0.05 %) (S1).`);
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
