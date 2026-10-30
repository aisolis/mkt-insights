/** Totales por mes de las cargas y de la versión vigente, con un cliente service_role (app, scripts y pruebas). */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mes } from "./tipos";

const NUMS = ["filas", "venta_neta", "kg", "dias", "duplicados", "discrepancias"] as const;
const aMes = (r: Record<string, unknown>): Mes => ({ ...(r as Mes), ...Object.fromEntries(NUMS.map((k) => [k, Number(r[k])])) });
const COLUMNAS_MES = "carga_id, anio, mes, filas, venta_neta, kg, dias, ultimo_dia, duplicados, discrepancias, canales_sin_homologar";

/** Meses que trae cada carga y meses de la versión vigente (cada uno con los totales de la carga de donde sale). */
export async function mesesParaAlertas(svc: SupabaseClient, cargaIds: string[]): Promise<{ porCarga: Map<string, Mes[]>; vigente: Mes[] }> {
  const vig = await svc.schema("ventas").from("publicacion").select("version").is("retirada_en", null).order("version", { ascending: false }).limit(1).maybeSingle();
  const comp = vig.data
    ? (await svc.schema("ventas").from("version_mes").select("anio, mes, carga_id").eq("version", vig.data.version)).data ?? []
    : [];
  const ids = [...new Set([...cargaIds, ...comp.map((c) => c.carga_id as string)])];
  const { data, error } = ids.length ? await svc.schema("ventas").from("carga_mes").select(COLUMNAS_MES).in("carga_id", ids) : { data: [], error: null };
  if (error) throw new Error(`carga_mes: ${error.message}`);
  const filas = (data ?? []) as Record<string, unknown>[];
  const porCarga = new Map(cargaIds.map((id) => [id, filas.filter((f) => f.carga_id === id).map(aMes)]));
  const vigente = comp.flatMap((c) => filas.filter((f) => f.carga_id === c.carga_id && f.anio === c.anio && f.mes === c.mes).map(aMes));
  return { porCarga, vigente };
}
