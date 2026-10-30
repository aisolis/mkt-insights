/**
 * Reglas de acceso sin dependencias de Next ni de Supabase (se prueban solas). La base aplica las mismas
 * (interno.nivel_acceso): esto decide a dónde mandar a la persona, la base decide qué datos ve.
 */
export type Nivel = "estandar" | "plus";
/** esAprobador: carga y publica versiones del cubo (G7) sin ser admin de usuarios. */
export type Usuario = { id: string; email: string; nombre: string; nivel: Nivel; esAdmin: boolean; esAprobador: boolean };
export type FilaPerfil = { nombre: string; nivel: Nivel; es_admin: boolean; es_aprobador?: boolean; activo: boolean };
export type Claims = { sub: string; email?: string; aal?: string };

export type Acceso =
  | { estado: "sin_sesion" }
  | { estado: "sin_2fa" }
  | { estado: "sin_perfil" }
  | { estado: "ok"; usuario: Usuario };

export function evaluarAcceso(claims: Claims | null | undefined, perfil: FilaPerfil | null | undefined): Acceso {
  if (!claims?.sub) return { estado: "sin_sesion" };
  if (claims.aal !== "aal2") return { estado: "sin_2fa" };
  if (!perfil?.activo) return { estado: "sin_perfil" };
  return { estado: "ok", usuario: { id: claims.sub, email: claims.email ?? "", nombre: perfil.nombre, nivel: perfil.nivel, esAdmin: perfil.es_admin, esAprobador: !!perfil.es_aprobador } };
}

/** Destino tras el login: solo rutas internas ("/x"), nunca "//host" ni URLs absolutas. */
export function rutaSegura(siguiente: unknown, porDefecto = "/"): string {
  if (typeof siguiente !== "string" || !siguiente.startsWith("/") || siguiente.startsWith("//") || siguiente.startsWith("/\\")) return porDefecto;
  // Recuperación con 2FA ya configurado: primero el código y después la clave nueva.
  if (siguiente === "/auth/clave") return siguiente;
  if (siguiente.startsWith("/login") || siguiente.startsWith("/auth/")) return porDefecto;
  return siguiente;
}

/** Rutas que se abren sin sesión: login y el flujo de invitación/recuperación/2FA. */
export function esRutaPublica(ruta: string) {
  return ruta === "/login" || ruta.startsWith("/auth/");
}

/** Cargar el cubo, publicar, retirar y conciliar versiones. */
export const gestionaCargas = (u: Usuario) => u.esAdmin || u.esAprobador;

export const NIVEL_TXT: Record<Nivel, string> = { estandar: "Estándar", plus: "Plus" };
