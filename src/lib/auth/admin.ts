import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { Nivel } from "./reglas";

/**
 * Administración de usuarios (Perfiles y accesos). Usa service_role porque Auth Admin lo exige; cada función
 * la llama una server action que ya verificó requerirAdmin(). Nunca se importa desde el cliente.
 */
/** Ámbito de datos (V1-02, S33): cada lista restringe esa dimensión; null = toda la venta interna. */
export type Alcance = { empresa?: string[]; canal?: string[]; ruta?: string[] } | null;
export type OpcionesAlcance = { empresa: string[]; canal: string[]; ruta: string[] };

export type FilaUsuario = {
  id: string; email: string; nombre: string; nivel: Nivel; esAdmin: boolean; esAprobador: boolean; activo: boolean; alcance: Alcance;
  estado: "invitado" | "sin_2fa" | "activo" | "inactivo"; ultimoIngreso: string | null; invitadoEn: string | null;
};

type FilaPerfil = { user_id: string; nombre: string; nivel: Nivel; es_admin: boolean; es_aprobador: boolean; activo: boolean; creado_en: string; alcance: Alcance };

export async function listarUsuarios(): Promise<FilaUsuario[]> {
  const svc = createServiceClient();
  const perfiles = await svc.from("perfil").select("user_id, nombre, nivel, es_admin, es_aprobador, activo, creado_en, alcance").order("creado_en").returns<FilaPerfil[]>();
  if (perfiles.error) throw new Error(`perfiles: ${perfiles.error.message}`);
  // listUsers no trae los factores de 2FA; getUserById sí. El piloto tiene pocas personas: una consulta por cada una.
  const usuarios = await Promise.all(perfiles.data.map((p) => svc.auth.admin.getUserById(p.user_id).then((r) => r.data.user)));
  return perfiles.data.map((p, i) => {
    const u = usuarios[i];
    const con2fa = !!u?.factors?.some((f) => f.factor_type === "totp" && f.status === "verified");
    const estado = !p.activo ? "inactivo" : !u?.email_confirmed_at ? "invitado" : !con2fa ? "sin_2fa" : "activo";
    return {
      id: p.user_id, email: u?.email ?? "—", nombre: p.nombre, nivel: p.nivel, esAdmin: p.es_admin, esAprobador: p.es_aprobador, activo: p.activo, alcance: p.alcance,
      estado, ultimoIngreso: u?.last_sign_in_at ?? null, invitadoEn: u?.invited_at ?? p.creado_en,
    };
  });
}

export type Invitacion = { email: string; nombre: string; nivel: Nivel; esAdmin: boolean };

/** Crea el usuario, le manda la invitación (SMTP de Supabase: Resend en el proyecto alojado, Mailpit en local)
 * y deja su perfil. Si el perfil falla, borra el usuario para no dejar cuentas sin perfil. */
export async function invitar(inv: Invitacion, invitadoPor: string | null): Promise<{ error?: string }> {
  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.inviteUserByEmail(inv.email, { data: { nombre: inv.nombre } });
  if (error || !data.user) {
    return { error: error?.code === "email_exists" || error?.status === 422 ? "Ya existe un usuario con ese correo." : `No se pudo enviar la invitación (${error?.message ?? "sin usuario"}).` };
  }
  const { error: e2 } = await svc.from("perfil").insert({ user_id: data.user.id, nombre: inv.nombre, nivel: inv.nivel, es_admin: inv.esAdmin, invitado_por: invitadoPor });
  if (e2) {
    await svc.auth.admin.deleteUser(data.user.id);
    return { error: `No se pudo crear el perfil (${e2.message}).` };
  }
  return {};
}

export async function reenviarInvitacion(userId: string): Promise<{ error?: string }> {
  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return { error: "No se encontró el usuario." };
  if (data.user.email_confirmed_at) return { error: "Ya aceptó la invitación: si olvidó la clave, que use «¿Olvidaste tu clave?»." };
  const r = await svc.auth.admin.inviteUserByEmail(data.user.email);
  return r.error ? { error: `No se pudo reenviar (${r.error.message}).` } : {};
}

export type Cambio = { nivel: Nivel } | { esAdmin: boolean } | { esAprobador: boolean } | { activo: boolean };

/** Cambia nivel, admin o estado. Desactivar corta el acceso a datos de inmediato (la base revisa perfil.activo
 * en cada consulta) y bloquea nuevos ingresos; reactivar quita el bloqueo. */
export async function cambiarPerfil(userId: string, cambio: Cambio): Promise<{ error?: string }> {
  const svc = createServiceClient();
  const fila = "nivel" in cambio ? { nivel: cambio.nivel } : "esAdmin" in cambio ? { es_admin: cambio.esAdmin }
    : "esAprobador" in cambio ? { es_aprobador: cambio.esAprobador } : { activo: cambio.activo };
  const { error } = await svc.from("perfil").update(fila).eq("user_id", userId);
  if (error) return { error: `No se pudo guardar (${error.message}).` };
  if ("activo" in cambio) {
    const r = await svc.auth.admin.updateUserById(userId, { ban_duration: cambio.activo ? "none" : "876000h" });
    if (r.error) return { error: `Perfil actualizado, pero no se pudo ${cambio.activo ? "desbloquear" : "bloquear"} el ingreso (${r.error.message}).` };
  }
  return {};
}

export async function opcionesAlcance(): Promise<OpcionesAlcance> {
  const { data, error } = await createServiceClient().schema("ventas").rpc("opciones_alcance");
  if (error) throw new Error(`opciones de ámbito: ${error.message}`);
  return data as OpcionesAlcance;
}

/**
 * Guarda el ámbito de una persona. Surte efecto en su próxima consulta: la base lo lee en cada lectura de cifras.
 * Solo acepta valores de la versión vigente (no se inventan rutas ni canales).
 */
export async function guardarAlcance(userId: string, alcance: Alcance): Promise<{ error?: string }> {
  if (alcance) {
    const op = await opcionesAlcance();
    for (const dim of ["empresa", "canal", "ruta"] as const) {
      const fuera = (alcance[dim] ?? []).filter((v) => !op[dim].includes(v));
      if (fuera.length) return { error: `No existe en la versión vigente: ${fuera.join(", ")}.` };
    }
  }
  const { error } = await createServiceClient().from("perfil").update({ alcance }).eq("user_id", userId);
  return error ? { error: `No se pudo guardar (${error.message}).` } : {};
}

/** «Toda la venta» o «Canal: Detalle, Mayoreo · Ruta: 3 rutas». */
export function describirAlcance(a: Alcance): string {
  if (!a) return "Toda la venta interna";
  const partes = (["empresa", "canal", "ruta"] as const).filter((d) => a[d]?.length).map((d) => {
    const v = a[d]!;
    const nombre = { empresa: "Empresa", canal: "Canal", ruta: "Ruta" }[d];
    return d === "ruta" && v.length > 3 ? `${nombre}: ${v.length} rutas` : `${nombre}: ${v.join(", ")}`;
  });
  return partes.join(" · ") || "Toda la venta interna";
}

