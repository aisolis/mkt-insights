/**
 * Memoria de una conversación (G8): lo que se recuerda de la última respuesta para seguir el hilo ("¿y en
 * Detalle?") sin mandar el chat completo al modelo. Sale SOLO de las consultas estructuradas que se ejecutaron
 * (periodo, comparado, filtros, dimensión y herramienta), nunca de la prosa del modelo ni de sus cifras.
 * Pura: la respuesta llega de la bitácora (jsonb), así que se valida campo por campo.
 */
import { Dimension, Filtros, Periodo, type VersionVigente } from "@/lib/semantic/contracts";
import type { Memoria, Respuesta } from "./tipos";

type Consulta = Respuesta["consultas"][number];

export function memoriaDe(respuesta: Respuesta | null): Memoria | undefined {
  if (!respuesta || respuesta.estado !== "ok" || !Array.isArray(respuesta.consultas)) return undefined;
  const consultas = respuesta.consultas.filter((c): c is Consulta => !!c && typeof c === "object" && typeof c.herramienta === "string");
  if (!consultas.length) return undefined;

  // La consulta principal es la primera con periodo (la serie mensual no tiene); sin ninguna, la primera.
  const principal = consultas.find((c) => Periodo.safeParse(c.periodo).success) ?? consultas[0];
  const periodo = Periodo.safeParse(principal.periodo);
  const comparado = Periodo.safeParse(principal.comparado);
  const filtros = Filtros.safeParse(principal.filtros);
  // La bitácora la escribe la sesión del usuario: la dimensión se acepta solo si es una de las del catálogo.
  const dim = Dimension.safeParse(consultas.find((c) => c.herramienta === "variacion_por_dimension")?.argumentos?.dimension);
  const dimension = dim.success ? dim.data : undefined;
  // kpi_periodo se agrega solo para la cobertura: la herramienta que define el hilo es la primera que no lo es.
  const herramienta = (consultas.find((c) => c.herramienta !== "kpi_periodo") ?? consultas[0]).herramienta;

  const memoria: Memoria = {
    ...(periodo.success ? { periodo: periodo.data } : {}),
    ...(periodo.success && comparado.success ? { comparado: comparado.data } : {}),
    ...(filtros.success && principal.filtros !== undefined ? { filtros: filtros.data } : {}),
    ...(dimension ? { dimension } : {}),
    herramienta,
  };
  return memoria;
}

/**
 * Deja en la memoria solo valores que existen en la versión vigente: periodos publicados y filtros del catálogo.
 * La bitácora la escribe la sesión del usuario, así que lo que entra al prompt se acota a valores conocidos.
 */
export function acotarMemoria(m: Memoria | undefined, meta: VersionVigente["metadatos"]): Memoria | undefined {
  if (!m) return undefined;
  const existe = (p?: Periodo) => !!p && meta.periodos.some((x) => x.anio === p.anio && x.mes === p.mes);
  const opciones: Record<keyof Filtros, string[]> = {
    empresa: ["MCM", "GKSA"], canal: meta.canal, ruta: meta.ruta, marca: meta.marca, art_codigo: meta.producto.map((p) => p.codigo),
  };
  const filtros = m.filtros && Object.fromEntries(
    Object.entries(m.filtros).filter(([k, v]) => typeof v === "string" && opciones[k as keyof Filtros]?.includes(v)),
  ) as Filtros;
  return {
    ...(existe(m.periodo) ? { periodo: m.periodo } : {}),
    ...(existe(m.periodo) && existe(m.comparado) ? { comparado: m.comparado } : {}),
    ...(filtros ? { filtros } : {}),
    ...(m.dimension ? { dimension: m.dimension } : {}),
    ...(m.herramienta ? { herramienta: m.herramienta } : {}),
  };
}
