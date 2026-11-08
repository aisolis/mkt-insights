/** Cargas y versiones (G7): constantes y tipos compartidos entre servidor y UI. */
export const BUCKET_CARGAS = "cargas";
export const MAX_BYTES_CARGA = 50 * 1024 * 1024;
export const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Totales de un mes: de una carga (lo que trae el archivo) o de la versión vigente (lo que se muestra hoy). */
export type Mes = { anio: number; mes: number; filas: number; venta_neta: number; kg: number; dias: number; ultimo_dia: string; duplicados: number; discrepancias: number; canales_sin_homologar: string[] };

export type Alerta = { nivel: "bloqueo" | "revisar" | "info"; texto: string };

export type FilaCarga = {
  id: string; nombre_archivo: string; estado: string; error: string | null; bytes: number | null;
  periodo_desde: string | null; periodo_hasta: string | null; filas_cargadas: number | null; filas_duplicadas: number | null;
  filas_discrepancia: number | null; creado_en: string; subido_por: string | null;
};

export type Version = {
  version: number; fecha_corte: string; publicado_en: string; archivo: string; notas: string | null; publicado_por: string | null;
  ultimo_mes_cerrado: boolean; meses: { anio: number; mes: number }[] | null; meses_reemplazados: { anio: number; mes: number }[];
  conciliada_bi: boolean; conciliada_nota: string | null; conciliada_en: string | null; retirada_en: string | null; motivo_retiro: string | null;
};

/** Venta neta de un canal (ya homologado) en un mes: de una carga o de la versión vigente. Alertas por canal (S20). */
export type CanalMes = { anio: number; mes: number; canal: string; venta_neta: number };

/** Equivalencia "canal de origen → canal BIA" (S2) y lo que queda pendiente de homologar en las cargas (S19). */
export type Homologacion = { valor_origen: string; valor_homologado: string; revisar: boolean };
export type CanalPendiente = {
  canal_origen: string; canal_actual: string; homologado_a: string | null; carga_id: string; archivo: string; estado: string;
  en_vigente: boolean; anio: number; mes: number; filas: number; venta_neta: number; kg: number;
};
export type CambioHomologacion = {
  id: number; valor_origen: string; accion: "creada" | "editada" | "eliminada"; antes: { valor_homologado: string } | null;
  despues: { valor_homologado: string } | null; cargas_actualizadas: { carga_id: string; archivo: string; filas: number }[];
  usuario: string | null; creado_en: string;
};
