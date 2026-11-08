import type { Estado } from "@/lib/asistente/bitacora-servidor";

export const ESTADO_TXT: Record<Estado, string> = {
  ok: "Respondida",
  fuera_de_alcance: "Fuera de alcance",
  sin_datos: "Sin datos",
  error: "Error",
};

const FECHA_HORA = new Intl.DateTimeFormat("es-HN", {
  timeZone: "America/Tegucigalpa", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

/** "7 nov., 14:32" en hora de Honduras. */
export const fechaHora = (instante: string) => FECHA_HORA.format(new Date(instante));

const UNO = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 });
export const segundos = (s: number) => UNO.format(s);

const MILES = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 0 });
/** «12,345». */
export const miles = (n: number) => MILES.format(n);

/** Valoración de la persona (G9). */
export const VALORACION_TXT = { true: "👍 Le sirvió", false: "👎 No le sirvió" } as const;
