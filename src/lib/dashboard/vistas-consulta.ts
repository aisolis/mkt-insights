/**
 * Vistas guardadas del dashboard (G9): partes puras, compartidas por el servidor (src/lib/dashboard/vistas.ts), la
 * barra de filtros y las pruebas. Una vista guarda la query string del dashboard pasada por leerParams +
 * queryString, así solo quedan parámetros conocidos y valores con forma válida.
 */
import { capital, periodoCorto } from "@/lib/format";
import type { PeriodoMeta } from "@/lib/semantic/contracts";
import { leerParams, queryString } from "./params";

export const MAX_NOMBRE_VISTA = 60;

/** Lo que el servidor devuelve de cada vista. `propia`: la creó quien la ve (puede renombrarla y borrarla). */
export type VistaGuardada = {
  id: string;
  nombre: string;
  consulta: string;
  compartida: boolean;
  propia: boolean;
  autor: string | null;
  actualizada_en: string;
};

/**
 * Query string limpia para guardar. `fijarPeriodo` false quita `periodo`: la vista sigue al último mes cerrado.
 * Con periodo fijo, uno que no existe en la versión se cambia por el de por defecto (lo decide leerParams).
 */
export function consultaDeVista(consulta: string, periodos: PeriodoMeta[], fijarPeriodo: boolean): string {
  const q = new URLSearchParams(queryString(leerParams(paramsDe(consulta), periodos)));
  if (!fijarPeriodo || !periodos.length) q.delete("periodo");
  return q.toString();
}

/** ¿La vista deja fijo el periodo? */
export const tienePeriodo = (consulta: string) => new URLSearchParams(consulta).has("periodo");

/** "Sep 2026" o "Último mes", más los filtros que trae (ej. "Último mes · Mayoreo · ORO"). */
export function resumenVista(consulta: string): string {
  const q = new URLSearchParams(consulta);
  const m = /^(\d{4})-(\d{2})$/.exec(q.get("periodo") ?? "");
  const partes = [m ? capital(periodoCorto({ anio: +m[1], mes: +m[2] })) : "Último mes"];
  if (q.get("comparar") === "anio") partes.push("vs. año anterior");
  for (const [k, v] of q) if (k !== "periodo" && k !== "comparar" && v) partes.push(k === "producto" ? `Producto ${v}` : v);
  return partes.join(" · ");
}

/**
 * ¿La vista coincide con lo que está en pantalla? Una vista sin periodo coincide cuando la pantalla muestra el
 * periodo por defecto (el último mes cerrado).
 */
export function vistaActiva(consulta: string, actual: string, periodos: PeriodoMeta[]): boolean {
  const deVista = queryString(leerParams(paramsDe(consulta), periodos));
  return deVista === queryString(leerParams(paramsDe(actual), periodos));
}

const paramsDe = (consulta: string) => Object.fromEntries(new URLSearchParams(consulta));
