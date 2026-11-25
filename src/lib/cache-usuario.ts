import "server-only";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

/**
 * Caché entre requests de lecturas POR USUARIO (perfil y versión vigente con su ámbito). Sin cacheComponents,
 * el mecanismo de esta versión de Next para funciones que no son fetch es unstable_cache
 * (docs: 02-guides/caching-without-cache-components.md, 04-functions/unstable_cache.md); se invalida con
 * updateTag desde las server actions (04-functions/updateTag.md).
 *
 * Reglas de uso:
 * - `userId` sale SIEMPRE de los claims del JWT ya verificado (getClaims), nunca de algo que mande el navegador.
 * - Se llama solo después de que el acceso del request pasó (lo garantiza credencialVerificada en acceso.ts).
 * - Dentro de `leer` no hay cookies ni connection() (unstable_cache no lo admite): se usa clienteConToken.
 * - Lo que devuelve `leer` debe ser JSON plano (se guarda con JSON.stringify); validar con zod afuera.
 */

/** Vida máxima de una entrada. Corte duro: el minuto va en la clave, así que nunca se sirve algo de otro minuto. */
export const TTL_S = 60;
/** Todo lo que depende de la versión publicada (publicar, retirar, conciliar con BI). */
export const TAG_VERSION = "bia:version-vigente";
/** Todo lo de una persona (perfil, nivel, ámbito): se invalida al cambiar su perfil o su ámbito. */
export const tagUsuario = (userId: string) => `bia:usuario:${userId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `leer()` guardado por (nombre, usuario, minuto en curso). unstable_cache sirve contenido vencido mientras
 * revalida (stale-while-revalidate), por eso el minuto va en la clave: así el tope de TTL_S es duro. Si `leer`
 * lanza, no se guarda nada y el error sale tal cual.
 */
export function enCacheDeUsuario<T>(nombre: string, userId: string, tags: string[], leer: () => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error("cache-usuario: id de usuario no válido");
  const minuto = Math.floor(Date.now() / (TTL_S * 1000));
  return unstable_cache(leer, ["bia-por-usuario", nombre, userId, String(minuto)], {
    tags: [tagUsuario(userId), ...tags],
    revalidate: TTL_S,
  })();
}

/**
 * Cliente de Supabase con el JWT del usuario ya verificado y sin cookies (se puede usar dentro de unstable_cache).
 * Las funciones de la base ven el mismo auth.uid()/aal que con la sesión: siguen exigiendo 2FA, perfil y ámbito.
 */
export function clienteConToken(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
