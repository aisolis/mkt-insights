import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { clienteConToken, enCacheDeUsuario } from "@/lib/cache-usuario";
import { createClient } from "@/lib/supabase/server";
import { evaluarAcceso, gestionaCargas, type Acceso, type Claims, type FilaPerfil, type Usuario } from "./reglas";

/**
 * Capa de acceso: toda página, route handler y server action con datos pasa por aquí. El proxy solo redirige
 * de forma optimista; la verificación real es esta (JWT verificado + aal2 + perfil activo) y la de la base.
 */

/**
 * La sesión del request con su JWT verificado. getClaims(token) es lo mismo que getClaims() (que lee la sesión y
 * verifica su token), pero deja a mano ese mismo token: con él se llenan las cachés por usuario sin cookies.
 */
const sesion = cache(async () => {
  const supabase = await createClient();
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) return { supabase, claims: undefined, token: undefined };
  const { data } = await supabase.auth.getClaims(token);
  return { supabase, claims: data?.claims as Claims | undefined, token };
});

const COLUMNAS_PERFIL = "nombre, nivel, es_admin, es_aprobador, activo";

/** Lanzado dentro de la caché para devolver un perfil sin guardarlo. */
class SinGuardar extends Error {
  constructor(readonly perfil: FilaPerfil | null) { super("perfil sin guardar en caché"); }
}

/**
 * Perfil con caché por usuario de hasta 60 s (cache-usuario.ts), invalidada al instante desde perfiles/acciones.ts.
 * Solo se guarda un perfil ACTIVO: inactivo, inexistente o con error se lee de nuevo en cada request, así que
 * reactivar a alguien vale al instante y desactivarlo, a más tardar en 60 s (o al instante desde la app).
 */
async function perfilEnCache(userId: string, token: string): Promise<FilaPerfil | null> {
  try {
    return await enCacheDeUsuario("perfil", userId, [], async () => {
      const { data, error } = await clienteConToken(token).from("perfil").select(COLUMNAS_PERFIL).eq("user_id", userId).maybeSingle<FilaPerfil>();
      if (error || !data?.activo) throw new SinGuardar(data ?? null);
      return data;
    });
  } catch (e) {
    if (e instanceof SinGuardar) return e.perfil;
    throw e;
  }
}

async function evaluar(conCache: boolean): Promise<Acceso> {
  const { supabase, claims, token } = await sesion();
  if (!claims?.sub || claims.aal !== "aal2" || !token) return evaluarAcceso(claims, null);
  const perfil = conCache
    ? await perfilEnCache(claims.sub, token)
    : (await supabase.from("perfil").select(COLUMNAS_PERFIL).eq("user_id", claims.sub).maybeSingle<FilaPerfil>()).data;
  return evaluarAcceso(claims, perfil);
}

/** Para navegar (páginas y layout): perfil con caché corta. Las cifras las vuelve a exigir la base en cada RPC. */
export const obtenerAcceso = cache((): Promise<Acceso> => evaluar(true));

/**
 * Sin caché: lo usan las guardas de acciones con service_role (admin, cargas) y los route handlers, donde un
 * cambio de rol o una desactivación tienen que valer en el acto aunque se hayan hecho fuera de la app.
 */
const obtenerAccesoAlDia = cache((): Promise<Acceso> => evaluar(false));

/**
 * Usuario y JWT verificados, solo si el acceso de ESTE request ya pasó (si no, null). Es la llave de las cachés
 * por usuario (queries.ts): el id sale de los claims verificados, nunca de algo que mande el navegador.
 */
export async function credencialVerificada(): Promise<{ userId: string; token: string } | null> {
  const acceso = await obtenerAcceso();
  if (acceso.estado !== "ok") return null;
  const { claims, token } = await sesion();
  if (!token || claims?.sub !== acceso.usuario.id) return null;
  return { userId: acceso.usuario.id, token };
}

function destino(acceso: Acceso): Usuario {
  if (acceso.estado === "sin_sesion") redirect("/login");
  if (acceso.estado === "sin_2fa") redirect("/auth/2fa");
  if (acceso.estado === "sin_perfil") redirect("/auth/sin-acceso");
  return acceso.usuario;
}

/** Para páginas: redirige al paso que falte. */
export async function requerirAcceso(): Promise<Usuario> {
  return destino(await obtenerAcceso());
}

/**
 * Como requerirAcceso, con el perfil al día (sin caché): para páginas que deciden con es_admin / es_aprobador si
 * hacen lecturas con service_role (cargas, conocimiento). Un cambio de rol hecho fuera de la app vale en el acto.
 */
export async function requerirAccesoAlDia(): Promise<Usuario> {
  return destino(await obtenerAccesoAlDia());
}

/** Admin: lo que sigue va con service_role, así que el perfil se lee al día (sin caché). */
export async function requerirAdmin(): Promise<Usuario> {
  const usuario = destino(await obtenerAccesoAlDia());
  if (!usuario.esAdmin) redirect("/");
  return usuario;
}

/** Cargar y publicar versiones: admin o aprobador (service_role: perfil al día, sin caché). */
export async function requerirGestorCargas(): Promise<Usuario> {
  const usuario = destino(await obtenerAccesoAlDia());
  if (!gestionaCargas(usuario)) redirect("/cargas");
  return usuario;
}

/**
 * Detalle por cliente (G9, S12, S16): solo Plus; el resto vuelve al inicio. La base lo exige igual
 * (interno.exigir_acceso('plus')): esto solo evita mostrar una pantalla que fallaría.
 */
export async function requerirPlus(): Promise<Usuario> {
  const usuario = await requerirAcceso();
  if (usuario.nivel !== "plus") redirect("/");
  return usuario;
}

/** Route handlers con detalle por cliente: como accesoApi, más 403 si el perfil no es Plus. */
export async function accesoApiPlus(): Promise<Usuario | Response> {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  if (usuario.nivel !== "plus") return Response.json({ error: "El detalle por cliente es solo para perfiles Plus" }, { status: 403 });
  return usuario;
}

/** Para route handlers: el usuario o la respuesta 401/403 lista para devolver (perfil al día, sin caché). */
export async function accesoApi(): Promise<Usuario | Response> {
  const acceso = await obtenerAccesoAlDia();
  if (acceso.estado === "ok") return acceso.usuario;
  if (acceso.estado === "sin_sesion") return Response.json({ error: "Sesión requerida" }, { status: 401 });
  return Response.json({ error: acceso.estado === "sin_2fa" ? "Falta la verificación en dos pasos" : "Tu usuario no tiene un perfil activo" }, { status: 403 });
}
