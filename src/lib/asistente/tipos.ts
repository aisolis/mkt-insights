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
import type { AdjuntosPregunta, CitaAdjunto } from "./adjuntos";
import type { TerminoGlosario } from "./glosario";

/** Las funciones del contrato semántico. En la app es src/lib/semantic/queries; en los tests, un cliente directo o un doble. */
export type Fuente = {
  kpiPeriodo(req: z.input<typeof KpiRequest>): Promise<Kpi>;
  variacionPorDimension(req: z.input<typeof VariacionRequest>): Promise<VariacionFila[]>;
  topContribuyentes(req: z.input<typeof TopRequest>): Promise<TopFila[]>;
  serieMensual(req: z.input<typeof SerieRequest>): Promise<SeriePunto[]>;
  descomposicion(req: z.input<typeof DescomposicionRequest>): Promise<Descomposicion>;
};

/**
 * Regla del asistente administrada por un admin (G8). `instruccion` y `definicion` van en las instrucciones de
 * sistema de cada llamada (no dependen del historial, así que no se olvidan); `bloqueo` lo aplica el código antes
 * de llamar al modelo, como los temas fuera de alcance: `texto` es el motivo que ve el usuario y `terminos` las
 * palabras o frases que lo activan. Ninguna regla puede saltarse el verificador de cifras ni el catálogo.
 */
export type ReglaAsistente = { id: string; tipo: "instruccion" | "definicion" | "bloqueo"; texto: string; terminos: string[] };

/**
 * Lo que una conversación recuerda de su última respuesta, estructurado y sin prosa ni cifras: sirve para
 * preguntas que siguen el hilo ("¿y en Detalle?") sin mandar el chat completo al modelo.
 */
export type Memoria = { periodo?: Periodo; comparado?: Periodo; filtros?: Filtros; dimension?: string; herramienta?: string };

/**
 * `documentos`: búsqueda en el conocimiento autorizado (G6); sin ella el asistente responde solo con el cubo.
 * `reglas`: reglas activas del asistente (G8). `memoria`: última consulta de la conversación (G8).
 * `glosario`: solo los términos del glosario que aparecen en la pregunta (ya elegidos; ver glosario.ts).
 * `adjuntos`: archivos o fotos que la persona subió a esta conversación (ver adjuntos.ts); sin ellos, undefined.
 */
export type Contexto = {
  fuente: Fuente; version: VersionVigente; estado: EstadoDashboard; documentos?: Buscador;
  reglas?: ReglaAsistente[]; memoria?: Memoria; glosario?: TerminoGlosario[]; adjuntos?: AdjuntosPregunta;
};

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
  /** Lo que se usó de los adjuntos de la persona: aparte de los hechos del cubo y de los documentos autorizados. */
  adjuntos?: CitaAdjunto[];
  consultas: Omit<Resultado, "resumen" | "hechos" | "visual">[];
};

export type Turno = { rol: "usuario" | "asistente"; texto: string };
