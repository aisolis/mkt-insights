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
  /** Ámbito de quien consulta (V1-02): las cifras ya vienen recortadas por la base. null = toda la venta. */
  alcance: z.object({ empresa: z.array(z.string()).optional(), canal: z.array(z.string()).optional(), ruta: z.array(z.string()).optional() })
    .nullable().optional(),
});
export type VersionVigente = z.infer<typeof VersionVigente>;

/** «canal Detalle · 3 rutas» para avisar en pantalla y al asistente que las cifras son de un ámbito. */
export function textoAlcance(a: VersionVigente["alcance"]): string | null {
  if (!a) return null;
  const partes = [
    a.empresa?.length && `empresa ${a.empresa.join(", ")}`,
    a.canal?.length && `${a.canal.length === 1 ? "canal" : "canales"} ${a.canal.join(", ")}`,
    a.ruta?.length && (a.ruta.length > 3 ? `${a.ruta.length} rutas` : `${a.ruta.length === 1 ? "ruta" : "rutas"} ${a.ruta.join(", ")}`),
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

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

// G9 — Análisis comercial (supabase/migrations/0014_analisis.sql) ------------------------------------------------

/** Puente precio–volumen–mezcla entre dos meses (S23). `limite`: productos por lista de detalle. */
export const PuenteRequest = KpiRequest.extend({ limite: z.number().int().min(1).max(50).default(5) });
export const ProductoPuente = z.object({
  art_codigo: z.string(), descripcion: z.string(), kg: z.number(), kg_cmp: z.number(), venta_neta: z.number(), venta_neta_cmp: z.number(),
  precio_kg: z.number(), precio_kg_cmp: z.number(), efecto_volumen: z.number(), efecto_precio: z.number(), efecto_mezcla: z.number(),
});
export type ProductoPuente = z.infer<typeof ProductoPuente>;
const ProductoCambio = z.object({ art_codigo: z.string(), descripcion: z.string(), variacion: z.number() });
/**
 * volumen + precio + mezcla + nuevos + descontinuados + sin_volumen = variacion, al centavo. Volumen, precio y mezcla
 * se calculan sobre los productos con kg en ambos meses; los demás van con su variación completa en su renglón.
 */
export const Puente = z.object({
  venta_neta: z.number(), venta_neta_cmp: z.number(), variacion: z.number(),
  volumen: z.number(), precio: z.number(), mezcla: z.number(), nuevos: z.number(), descontinuados: z.number(), sin_volumen: z.number(),
  kg_comparables: z.number(), kg_comparables_cmp: z.number(),
  precio_kg_comparables: z.number().nullable(), precio_kg_comparables_cmp: z.number().nullable(),
  productos_comparables: z.number(), productos_nuevos: z.number(), productos_descontinuados: z.number(), productos_sin_volumen: z.number(),
  detalle_precio: z.array(ProductoPuente), detalle_mezcla: z.array(ProductoPuente),
  principales_nuevos: z.array(ProductoCambio), principales_descontinuados: z.array(ProductoCambio),
});
export type Puente = z.infer<typeof Puente>;

/** Acumulado del año: enero..mes de `periodo` contra el mismo tramo del año anterior (S24). */
export const AcumuladoRequest = z.object({ version: z.number().int(), periodo: Periodo, filtros: Filtros });
export const Acumulado = z.object({
  anio: z.number().int(), mes: z.number().int(),
  venta_neta: z.number(), kg: z.number(), precio_kg: z.number().nullable(), clientes_con_compra: z.number(),
  venta_neta_cmp: z.number(), kg_cmp: z.number(), precio_kg_cmp: z.number().nullable(), clientes_con_compra_cmp: z.number(),
  /** Meses con datos en la versión dentro de cada tramo. */
  meses: z.array(z.number().int()), meses_cmp: z.array(z.number().int()),
});
export type Acumulado = z.infer<typeof Acumulado>;

/** Rutas cuya variación del mes contra el mes anterior se sale de su historia de 12 meses (S25). */
export const AtipicasRequest = z.object({ version: z.number().int(), periodo: Periodo, filtros: Filtros, limite: z.number().int().min(1).max(50).default(10) });
export const RutaAtipica = z.object({
  ruta: z.string(), canal: z.string(), actual: z.number(), anterior: z.number(), variacion: z.number(),
  /** Cambios como fracción: 0.25 = +25 %. */
  cambio: z.number(), mediana: z.number(), escala: z.number(), minimo: z.number(), maximo: z.number(),
  puntaje: z.number(), meses_historia: z.number().int(), promedio_mensual: z.number(),
});
export type RutaAtipica = z.infer<typeof RutaAtipica>;
export const RutasAtipicas = z.object({
  hay_periodo: z.boolean(), hay_anterior: z.boolean(),
  rutas_evaluadas: z.number(), rutas_pequenas: z.number(), rutas_sin_historia: z.number(), rutas_fuera: z.number(),
  umbral_promedio: z.number(),
  rutas: z.array(RutaAtipica),
});
export type RutasAtipicas = z.infer<typeof RutasAtipicas>;
