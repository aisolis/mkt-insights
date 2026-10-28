import "server-only";
import { createClient } from "@/lib/supabase/server";
import { Kpi, KpiRequest, SeriePunto, SerieRequest, VariacionFila, VariacionRequest } from "./contracts";
import { z } from "zod";

async function rpc<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("ventas").rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return schema.parse(data);
}

export async function kpiPeriodo(req: z.input<typeof KpiRequest>) {
  const r = KpiRequest.parse(req);
  return rpc("kpi_periodo", {
    p_version: r.version, p_anio: r.periodo.anio, p_mes: r.periodo.mes,
    p_anio_cmp: r.comparar.anio, p_mes_cmp: r.comparar.mes, p_filtros: r.filtros,
  }, Kpi);
}

export async function variacionPorDimension(req: z.input<typeof VariacionRequest>) {
  const r = VariacionRequest.parse(req);
  return rpc("variacion_por_dimension", {
    p_version: r.version, p_dimension: r.dimension, p_anio: r.periodo.anio, p_mes: r.periodo.mes,
    p_anio_cmp: r.comparar.anio, p_mes_cmp: r.comparar.mes, p_filtros: r.filtros,
  }, z.array(VariacionFila));
}

export async function serieMensual(req: z.input<typeof SerieRequest>) {
  const r = SerieRequest.parse(req);
  return rpc("serie_mensual", { p_version: r.version, p_anio: r.anio, p_filtros: r.filtros }, z.array(SeriePunto));
}
