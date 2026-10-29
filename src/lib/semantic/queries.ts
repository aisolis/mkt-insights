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
