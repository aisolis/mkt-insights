import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { crearConsultas, type Rpc } from "./consultas";

// Lee con la sesión del usuario: las funciones de ventas exigen aal2 y perfil activo (0006_acceso.sql) y solo
// devuelven agregados. service_role queda para scripts y para la administración de usuarios.
const rpc: Rpc = async (fn, args, schema) => {
  await connection(); // las cifras dependen de la versión publicada al momento del request, nunca del build
  const supabase = await createClient();
  const { data, error } = await supabase.schema("ventas").rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return schema.parse(data);
};

const consultas = crearConsultas(rpc);

/** Una consulta por request (layout + página). */
export const versionVigente = cache(consultas.versionVigente);
export const { kpiPeriodo, variacionPorDimension, topContribuyentes, serieMensual, descomposicion } = consultas;
/** G9: análisis comercial (0014_analisis.sql). */
export const { puentePrecioVolumenMezcla, acumuladoAnio, rutasAtipicas } = consultas;

export type FilaBitacora = {
  usuario_id: string; version: number | null; contexto: string; pregunta: string; estado: "ok" | "fuera_de_alcance" | "sin_datos" | "error";
  modo: "modelo" | "determinista" | null; modelo: string | null; texto: string | null; respuesta: unknown; error: string | null; duracion_ms: number;
};

