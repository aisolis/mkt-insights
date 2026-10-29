import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { Kpi, KpiRequest, SeriePunto, SerieRequest, TopFila, TopRequest, VariacionFila, VariacionRequest, VersionVigente } from "./contracts";
import { z } from "zod";

// TODO G5: usar createClient() (sesión del usuario + RLS por perfil). Hasta que exista Auth no hay sesión ni
// políticas, así que se lee con service_role SOLO desde el servidor y SOLO contra el Supabase local (Docker):
// contra un proyecto alojado falla cerrado, para que un despliegue antes de G5 no exponga el cubo sin login.
const HOSTS_LOCALES = new Set(["127.0.0.1", "localhost", "[::1]"]);
function clienteSinAuth() {
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido").hostname;
  if (!HOSTS_LOCALES.has(host)) throw new Error("Lectura sin sesión deshabilitada fuera del Supabase local hasta G5 (Auth + RLS).");
  return createServiceClient();
}

async function rpc<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  await connection(); // las cifras dependen de la versión publicada al momento del request, nunca del build
  const supabase = clienteSinAuth();
  const { data, error } = await supabase.schema("ventas").rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return schema.parse(data);
}

/** Última versión publicada con sus metadatos, o null si todavía no hay ninguna. Una consulta por request (layout + página). */
export const versionVigente = cache(async () => rpc("version_vigente", {}, VersionVigente.nullable()));

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

export async function topContribuyentes(req: z.input<typeof TopRequest>) {
  const r = TopRequest.parse(req);
  return rpc("top_contribuyentes", {
    p_version: r.version, p_anio: r.periodo.anio, p_mes: r.periodo.mes,
    p_anio_cmp: r.comparar.anio, p_mes_cmp: r.comparar.mes, p_filtros: r.filtros, p_limite: r.limite,
  }, z.array(TopFila));
}

export async function serieMensual(req: z.input<typeof SerieRequest>) {
  const r = SerieRequest.parse(req);
  return rpc("serie_mensual", { p_version: r.version, p_anio: r.anio, p_filtros: r.filtros }, z.array(SeriePunto));
}
