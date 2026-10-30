/**
 * Tipos del asistente (G4). La IA interpreta, no calcula: toda cifra de una respuesta sale de una consulta
 * controlada (src/lib/semantic) y viaja con su evidencia.
 */
import type { PuntoSerie } from "@/components/dashboard/serie-chart";
import type { Buscador, Cita } from "@/lib/conocimiento/tipos";
import type { EstadoDashboard } from "@/lib/dashboard/params";
import type {
  Descomposicion, DescomposicionRequest, Filtros, Kpi, KpiRequest, Periodo, SeriePunto, SerieRequest,
  TopFila, TopRequest, VariacionFila, VariacionRequest, VersionVigente,
} from "@/lib/semantic/contracts";
import type { z } from "zod";

/** Las funciones del contrato semántico. En la app es src/lib/semantic/queries; en los tests, un cliente directo o un doble. */
export type Fuente = {
  kpiPeriodo(req: z.input<typeof KpiRequest>): Promise<Kpi>;
  variacionPorDimension(req: z.input<typeof VariacionRequest>): Promise<VariacionFila[]>;
  topContribuyentes(req: z.input<typeof TopRequest>): Promise<TopFila[]>;
  serieMensual(req: z.input<typeof SerieRequest>): Promise<SeriePunto[]>;
  descomposicion(req: z.input<typeof DescomposicionRequest>): Promise<Descomposicion>;
};

/** `documentos`: búsqueda en el conocimiento autorizado (G6); sin ella el asistente responde solo con el cubo. */
export type Contexto = { fuente: Fuente; version: VersionVigente; estado: EstadoDashboard; documentos?: Buscador };

export type Visual =
  | { tipo: "variacion"; titulo: string; filas: VariacionFila[] }
  | { tipo: "serie"; titulo: string; anio: number; mesSeleccionado: number; puntos: PuntoSerie[] }
  | { tipo: "tabla"; titulo: string; columnas: string[]; filas: string[][] };

/** Una consulta ejecutada: lo que ve el usuario en "Ver consulta y datos" y lo que recibe el modelo (resumen). */
export type Resultado = {
  id: string;
  herramienta: string;
  argumentos: Record<string, unknown>;
  calculo: string;
  periodo?: Periodo;
  comparado?: Periodo;
  filtros: Filtros;
  datos: unknown;
  resumen: unknown;
  hechos: string[];
  visual?: Visual;
};

export type Evidencia = {
  fuente: string;
  version: number;
  fecha_corte: string;
  conciliada_bi: boolean;
  periodo: string;
  filtros: string;
  cobertura: string | null;
  calculo: string[];
  advertencias: string[];
};

export type Respuesta = {
  estado: "ok" | "fuera_de_alcance" | "sin_datos";
  modo: "modelo" | "determinista";
  texto: string;
  hechos: string[];
  hipotesis: string[];
  visuales: Visual[];
  evidencia: Evidencia;
  /** Contexto de documentos autorizados: se muestra aparte y nunca cuenta como hecho del cubo. */
  contexto: Cita[];
  consultas: Omit<Resultado, "resumen" | "hechos" | "visual">[];
};

export type Turno = { rol: "usuario" | "asistente"; texto: string };
