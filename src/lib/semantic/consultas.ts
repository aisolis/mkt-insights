import type { z } from "zod";
import { z as zod } from "zod";
import {
  Descomposicion, DescomposicionRequest, Kpi, KpiRequest, SeriePunto, SerieRequest, TopFila, TopRequest,
  VariacionFila, VariacionRequest, VersionVigente,
} from "./contracts";

/** Llama una función del esquema ventas y valida su respuesta. */
export type Rpc = <T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>) => Promise<T>;

/** Las consultas del contrato semántico sobre cualquier transporte (app: queries.ts; tests: cliente directo). */
export function crearConsultas(rpc: Rpc) {
  return {
    /** Última versión publicada con sus metadatos, o null si todavía no hay ninguna. */
    versionVigente: () => rpc("version_vigente", {}, VersionVigente.nullable()),

    kpiPeriodo(req: z.input<typeof KpiRequest>) {
      const r = KpiRequest.parse(req);
      return rpc("kpi_periodo", {
        p_version: r.version, p_anio: r.periodo.anio, p_mes: r.periodo.mes,
        p_anio_cmp: r.comparar.anio, p_mes_cmp: r.comparar.mes, p_filtros: r.filtros,
      }, Kpi);
    },

    variacionPorDimension(req: z.input<typeof VariacionRequest>) {
      const r = VariacionRequest.parse(req);
      return rpc("variacion_por_dimension", {
        p_version: r.version, p_dimension: r.dimension, p_anio: r.periodo.anio, p_mes: r.periodo.mes,
        p_anio_cmp: r.comparar.anio, p_mes_cmp: r.comparar.mes, p_filtros: r.filtros,
      }, zod.array(VariacionFila));
    },

    topContribuyentes(req: z.input<typeof TopRequest>) {
      const r = TopRequest.parse(req);
      return rpc("top_contribuyentes", {
        p_version: r.version, p_anio: r.periodo.anio, p_mes: r.periodo.mes,
        p_anio_cmp: r.comparar.anio, p_mes_cmp: r.comparar.mes, p_filtros: r.filtros, p_limite: r.limite,
      }, zod.array(TopFila));
    },

    serieMensual(req: z.input<typeof SerieRequest>) {
      const r = SerieRequest.parse(req);
      return rpc("serie_mensual", { p_version: r.version, p_anio: r.anio, p_filtros: r.filtros }, zod.array(SeriePunto));
    },

    descomposicion(req: z.input<typeof DescomposicionRequest>) {
      const r = DescomposicionRequest.parse(req);
      return rpc("descomposicion", {
        p_version: r.version, p_anio: r.periodo.anio, p_mes: r.periodo.mes,
        p_anio_cmp: r.comparar.anio, p_mes_cmp: r.comparar.mes, p_filtros: r.filtros,
      }, Descomposicion);
    },
  };
}
