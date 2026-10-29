import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { crearConsultas, type Rpc } from "./consultas";

// TODO G5: usar createClient() (sesión del usuario + RLS por perfil). Hasta que exista Auth no hay sesión ni
// políticas, así que se lee con service_role SOLO desde el servidor y SOLO contra el Supabase local (Docker):
// contra un proyecto alojado falla cerrado, para que un despliegue antes de G5 no exponga el cubo sin login.
const HOSTS_LOCALES = new Set(["127.0.0.1", "localhost", "[::1]"]);
function clienteSinAuth() {
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido").hostname;
  if (!HOSTS_LOCALES.has(host)) throw new Error("Lectura sin sesión deshabilitada fuera del Supabase local hasta G5 (Auth + RLS).");
  return createServiceClient();
}

const rpc: Rpc = async (fn, args, schema) => {
  await connection(); // las cifras dependen de la versión publicada al momento del request, nunca del build
  const supabase = clienteSinAuth();
  const { data, error } = await supabase.schema("ventas").rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return schema.parse(data);
};

const consultas = crearConsultas(rpc);

/** Una consulta por request (layout + página). */
export const versionVigente = cache(consultas.versionVigente);
export const { kpiPeriodo, variacionPorDimension, topContribuyentes, serieMensual, descomposicion } = consultas;

export type FilaBitacora = {
  version: number | null; contexto: string; pregunta: string; estado: "ok" | "fuera_de_alcance" | "sin_datos" | "error";
  modo: "modelo" | "determinista" | null; modelo: string | null; texto: string | null; respuesta: unknown; error: string | null; duracion_ms: number;
};

/** Registra una pregunta del asistente (ventas.consulta_asistente). Si falla, no rompe la respuesta. */
export async function registrarConsultaAsistente(fila: FilaBitacora) {
  try {
    const { error } = await clienteSinAuth().schema("ventas").from("consulta_asistente").insert(fila);
    if (error) console.error("bitácora del asistente:", error.message);
  } catch (e) {
    console.error("bitácora del asistente:", e);
  }
}
