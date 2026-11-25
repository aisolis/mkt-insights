import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { credencialVerificada } from "@/lib/auth/acceso";
import { clienteConToken, enCacheDeUsuario, TAG_VERSION } from "@/lib/cache-usuario";
import { createClient } from "@/lib/supabase/server";
import { crearConsultas, type Rpc } from "./consultas";
import { VersionVigente } from "./contracts";

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

/**
 * Una consulta por request (layout + página) y, entre requests, caché POR USUARIO de hasta 60 s: la respuesta trae
 * el ámbito de quien consulta (0026_alcance.sql), así que la clave es su id verificado y nunca se comparte. Solo se
 * lee cuando el acceso de este request ya pasó; se invalida al publicar/retirar/conciliar (cargas/acciones.ts) y al
 * cambiar el perfil o el ámbito de la persona (perfiles/acciones.ts). Los errores no se guardan.
 */
export const versionVigente = cache(async (): Promise<VersionVigente | null> => {
  await connection(); // las cifras dependen de la versión publicada al momento del request, nunca del build
  const cred = await credencialVerificada();
  // Sin acceso la base niega igual (interno.exigir_acceso): no se consulta ni se toca la caché.
  if (!cred) throw new Error("version_vigente: acceso denegado: se requiere sesión con 2FA y perfil activo");
  const datos = await enCacheDeUsuario("version_vigente", cred.userId, [TAG_VERSION], async () => {
    const { data, error } = await clienteConToken(cred.token).schema("ventas").rpc("version_vigente", {});
    if (error) throw new Error(`version_vigente: ${error.message}`);
    return data as unknown;
  });
  return VersionVigente.nullable().parse(datos);
});
export const { kpiPeriodo, variacionPorDimension, topContribuyentes, serieMensual, descomposicion } = consultas;
/** G9: análisis comercial (0014_analisis.sql). */
export const { puentePrecioVolumenMezcla, acumuladoAnio, rutasAtipicas } = consultas;

export type FilaBitacora = {
  usuario_id: string; version: number | null; contexto: string; pregunta: string; estado: "ok" | "fuera_de_alcance" | "sin_datos" | "error";
  modo: "modelo" | "determinista" | null; modelo: string | null; texto: string | null; respuesta: unknown; error: string | null; duracion_ms: number;
};

