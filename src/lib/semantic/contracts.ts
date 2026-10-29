import { z } from "zod";

/**
 * Contrato único de consulta. Dashboard, asistente y exportación pasan por aquí;
 * el cálculo vive en PostgreSQL (supabase/migrations/0002_funciones.sql, 0003_dashboard.sql).
 */
export const Dimension = z.enum([
  "canal", "ruta", "zona", "sucursal", "marca", "categoria", "art_codigo", "empresa",
]);
export type Dimension = z.infer<typeof Dimension>;

export const Periodo = z.object({ anio: z.number().int(), mes: z.number().int().min(1).max(12) });
export type Periodo = z.infer<typeof Periodo>;

/** "anterior" = mes anterior; "anio" = mismo mes del año anterior. */
export const Comparacion = z.enum(["anterior", "anio"]);
export type Comparacion = z.infer<typeof Comparacion>;

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
  rutas_con_venta: z.number(), rutas_total: z.number(),
});
export type Kpi = z.infer<typeof Kpi>;

export const VariacionRequest = KpiRequest.extend({ dimension: Dimension });
export const VariacionFila = z.object({ valor: z.string(), actual: z.number(), anterior: z.number(), variacion: z.number() });
export type VariacionFila = z.infer<typeof VariacionFila>;

export const TopRequest = KpiRequest.extend({ limite: z.number().int().min(1).max(5000).default(10) });
export const TopFila = z.object({ ruta: z.string(), canal: z.string(), actual: z.number(), anterior: z.number(), variacion: z.number() });
export type TopFila = z.infer<typeof TopFila>;

export const SerieRequest = z.object({ version: z.number().int(), anio: z.number().int(), filtros: Filtros });
export const SeriePunto = z.object({ anio: z.number(), mes: z.number(), venta_neta: z.number(), kg: z.number() });
export type SeriePunto = z.infer<typeof SeriePunto>;

/** Metadatos fijos de la versión, calculados al publicar (ventas._metadatos_carga). */
export const PeriodoMeta = z.object({ anio: z.number(), mes: z.number(), dias: z.number(), ultimo_dia: z.string(), cerrado: z.boolean() });
export type PeriodoMeta = z.infer<typeof PeriodoMeta>;
export const VersionVigente = z.object({
  version: z.number().int(),
  fecha_corte: z.string(),
  conciliada_bi: z.boolean(),
  publicado_en: z.string(),
  archivo: z.string(),
  metadatos: z.object({
    periodos: z.array(PeriodoMeta),
    canal: z.array(z.string()),
    ruta: z.array(z.string()),
    marca: z.array(z.string()),
    producto: z.array(z.object({ codigo: z.string(), descripcion: z.string() })),
    rutas_total: z.number(),
  }),
});
export type VersionVigente = z.infer<typeof VersionVigente>;

/** Variación relativa; null si la base es cero (no hay % contra nada). */
export function variacionPct(actual: number, base: number): number | null {
  return base === 0 ? null : ((actual - base) / Math.abs(base)) * 100;
}

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

export const DescomposicionRequest = KpiRequest;
const LadoDescomposicion = z.object({
  venta_neta: z.number(), kg: z.number(), lineas: z.number(), clientes: z.number(), facturas: z.number(),
  facturas_por_cliente: z.number().nullable(), ticket_factura: z.number().nullable(), venta_por_cliente: z.number().nullable(),
});
/** Clientes, facturas y ticket de ambos periodos (ventas.descomposicion, S4 y S14). */
export const Descomposicion = z.object({ actual: LadoDescomposicion, anterior: LadoDescomposicion });
export type Descomposicion = z.infer<typeof Descomposicion>;
