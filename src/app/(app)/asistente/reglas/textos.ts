import type { ReglaAsistente } from "@/lib/asistente/tipos";

/** Textos de cada tipo de regla, compartidos por la página (servidor) y los formularios (cliente). */
export const TIPO_INFO: Record<ReglaAsistente["tipo"], { nombre: string; plural: string; que: string; ejemplo: string; campo: string }> = {
  instruccion: {
    nombre: "Instrucción",
    plural: "Instrucciones",
    que: "Una indicación de cómo responder. La IA la recibe con cada pregunta.",
    ejemplo: "Cuando hables de Moderno, aclara que incluye supermercados y cadenas.",
    campo: "Indicación para la IA",
  },
  definicion: {
    nombre: "Definición",
    plural: "Definiciones",
    que: "Qué significa un término de BIA, para que la IA lo use al redactar. No cambia cómo se calculan las cifras.",
    ejemplo: "Ticket = venta neta / facturas.",
    campo: "Definición",
  },
  bloqueo: {
    nombre: "Bloqueo",
    plural: "Bloqueos",
    que: "Un tema que el asistente no responde. Si la pregunta trae alguna de las palabras o frases, se contesta con tu mensaje, sin consultar datos y sin llamar a la IA.",
    ejemplo: "Frases: «precio de la competencia», «precios de la competencia». Mensaje: «Los precios de la competencia no están en los datos de venta; pídelos a Insights.»",
    campo: "Mensaje que verá la persona",
  },
};

export const ORDEN_TIPOS: ReglaAsistente["tipo"][] = ["instruccion", "definicion", "bloqueo"];
