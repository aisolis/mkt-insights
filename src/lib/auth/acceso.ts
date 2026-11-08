import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { evaluarAcceso, gestionaCargas, type Acceso, type Claims, type FilaPerfil, type Usuario } from "./reglas";

/**
 * Capa de acceso: toda página, route handler y server action con datos pasa por aquí. El proxy solo redirige
 * de forma optimista; la verificación real es esta (JWT verificado + aal2 + perfil activo) y la de la base.
 */
export const obtenerAcceso = cache(async (): Promise<Acceso> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as Claims | undefined;
  if (!claims?.sub || claims.aal !== "aal2") return evaluarAcceso(claims, null);
  const { data: perfil } = await supabase.from("perfil").select("nombre, nivel, es_admin, es_aprobador, activo").eq("user_id", claims.sub).maybeSingle<FilaPerfil>();
  return evaluarAcceso(claims, perfil);
});

/** Para páginas: redirige al paso que falte. */
export async function requerirAcceso(): Promise<Usuario> {
  const acceso = await obtenerAcceso();
  if (acceso.estado === "sin_sesion") redirect("/login");
  if (acceso.estado === "sin_2fa") redirect("/auth/2fa");
  if (acceso.estado === "sin_perfil") redirect("/auth/sin-acceso");
  return acceso.usuario;
}

export async function requerirAdmin(): Promise<Usuario> {
  const usuario = await requerirAcceso();
  if (!usuario.esAdmin) redirect("/");
  return usuario;
}

/** Cargar y publicar versiones: admin o aprobador. */
export async function requerirGestorCargas(): Promise<Usuario> {
  const usuario = await requerirAcceso();
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

/** Para route handlers: el usuario o la respuesta 401/403 lista para devolver. */
export async function accesoApi(): Promise<Usuario | Response> {
  const acceso = await obtenerAcceso();
  if (acceso.estado === "ok") return acceso.usuario;
  if (acceso.estado === "sin_sesion") return Response.json({ error: "Sesión requerida" }, { status: 401 });
  return Response.json({ error: acceso.estado === "sin_2fa" ? "Falta la verificación en dos pasos" : "Tu usuario no tiene un perfil activo" }, { status: 403 });
}
