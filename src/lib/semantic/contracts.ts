import { z } from "zod";

/**
 * Contrato único de consulta. Dashboard, asistente y exportación pasan por aquí;
 * el cálculo vive en PostgreSQL (supabase/migrations/0002_funciones.sql).
 */
export const Dimension = z.enum([
  "canal", "ruta", "zona", "sucursal", "marca", "categoria", "art_codigo", "empresa",
]);
export type Dimension = z.infer<typeof Dimension>;

export const Periodo = z.object({ anio: z.number().int(), mes: z.number().int().min(1).max(12) });
export type Periodo = z.infer<typeof Periodo>;

export const Filtros = z.object({
  empresa: z.string().optional(),
  canal: z.string().optional(),
  ruta: z.string().optional(),
  marca: z.string().optional(),
  art_codigo: z.string().optional(),
}).default({});
export type Filtros = z.infer<typeof Filtros>;

export const KpiRequest = z.object({ version: z.number().int(), periodo: Periodo, comparar: Periodo, filtros: Filtros });
export const Kpi = z.object({
  venta_neta: z.number(), kg: z.number(), precio_kg: z.number().nullable(), clientes_con_compra: z.number(),
  venta_neta_cmp: z.number(), kg_cmp: z.number(), precio_kg_cmp: z.number().nullable(), clientes_con_compra_cmp: z.number(),
});
export type Kpi = z.infer<typeof Kpi>;

export const VariacionRequest = KpiRequest.extend({ dimension: Dimension });
export const VariacionFila = z.object({ valor: z.string(), actual: z.number(), anterior: z.number(), variacion: z.number() });

export const SerieRequest = z.object({ version: z.number().int(), anio: z.number().int(), filtros: Filtros });
export const SeriePunto = z.object({ anio: z.number(), mes: z.number(), venta_neta: z.number(), kg: z.number() });

/** Evidencia que acompaña toda cifra mostrada o dicha por el asistente. */
export type Evidencia = {
  fuente: string;           // "Cubo de ventas BIA · exportación <archivo>"
  version: number;
  fecha_corte: string;
  periodo: string;
  filtros: Filtros;
  calculo: string;          // nombre de la función SQL usada
  advertencias: string[];   // p. ej. "Octubre 2026 parcial (12 días)"
};
