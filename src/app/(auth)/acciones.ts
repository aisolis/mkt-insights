"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { registrarEvento } from "@/lib/auditoria";
import { rutaSegura } from "@/lib/auth/reglas";
import { createClient } from "@/lib/supabase/server";

export type EstadoForm = { error?: string; ok?: string } | null;

const conSiguiente = (ruta: string, siguiente: unknown) => {
  const s = rutaSegura(siguiente, "");
  return s ? `${ruta}?siguiente=${encodeURIComponent(s)}` : ruta;
};

export async function iniciarSesion(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const datos = z.object({ email: z.email(), clave: z.string().min(1) }).safeParse({ email: form.get("email"), clave: form.get("clave") });
  if (!datos.success) return { error: "Escribe tu correo y tu clave." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: datos.data.email, password: datos.data.clave });
  if (error) {
    if (error.code === "user_banned") return { error: "Tu acceso está desactivado. Pide acceso a quien administra BIA Foresight." };
    return { error: error.code === "over_request_rate_limit" ? "Demasiados intentos. Espera unos minutos." : "Correo o clave incorrectos." };
  }
  redirect(conSiguiente("/auth/2fa", form.get("siguiente")));
}

/** Llega de un enlace de invitación o recuperación. Se confirma con un botón (POST) y no al abrir el enlace,
 * para que los escáneres de correo que visitan los links no gasten el token de un solo uso. */
export async function confirmarEnlace(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const datos = z.object({ token_hash: z.string().min(10), type: z.enum(["invite", "recovery"]) })
    .safeParse({ token_hash: form.get("token_hash"), type: form.get("type") });
  if (!datos.success) return { error: "El enlace no es válido." };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp(datos.data);
  if (error) return { error: "El enlace venció o ya se usó. Pide uno nuevo." };
  redirect("/auth/clave");
}

const Clave = z.string()
  .min(10, "La clave debe tener al menos 10 caracteres.")
  .regex(/[a-zA-Z]/, "La clave debe incluir letras.")
  .regex(/\d/, "La clave debe incluir números.");

export async function definirClave(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const clave = Clave.safeParse(form.get("clave"));
  if (!clave.success) return { error: clave.error.issues[0].message };
  if (form.get("confirmacion") !== clave.data) return { error: "Las dos claves no coinciden." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: clave.data });
  if (error) return { error: error.code === "same_password" ? "La clave nueva debe ser distinta de la anterior." : error.code === "weak_password" ? "La clave es muy débil." : "No se pudo guardar la clave." };
  redirect("/auth/2fa");
}

export async function pedirRecuperacion(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Escribe un correo válido." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data);
  // Misma respuesta exista o no la cuenta, para no revelar quién tiene acceso.
  return { ok: "Si el correo tiene acceso, te llegará un enlace para definir una clave nueva." };
}

export type Enrolamiento = { factorId: string; qr: string; secreto: string } | { error: string };

/** Alta del factor TOTP. Borra antes los intentos sin verificar (alguien que cerró la página a medias). */
export async function enrolarTotp(): Promise<Enrolamiento> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return { error: "Tu sesión venció. Vuelve a entrar." };
  const { data: factores } = await supabase.auth.mfa.listFactors();
  if (factores?.totp.length) return { error: "Ya tienes la verificación en dos pasos configurada." };
  for (const f of factores?.all ?? []) if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "BIA Foresight", issuer: "BIA Foresight" });
  if (error || !data) return { error: "No se pudo iniciar la configuración. Intenta de nuevo." };
  const qr = data.totp.qr_code.startsWith("data:") ? data.totp.qr_code : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`;
  return { factorId: data.id, qr, secreto: data.totp.secret };
}

export async function verificarTotp(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const codigo = String(form.get("codigo") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(codigo)) return { error: "El código tiene 6 dígitos." };
  const supabase = await createClient();
  let factorId = String(form.get("factorId") ?? "");
  if (!factorId) {
    const { data } = await supabase.auth.mfa.listFactors();
    factorId = data?.totp[0]?.id ?? "";
  }
  if (!factorId) return { error: "No hay un factor configurado." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo });
  const { data: sesion } = await supabase.auth.getClaims();
  const quien = (sesion?.claims?.sub as string | undefined) ?? null;
  if (error) {
    await registrarEvento(quien, "codigo_fallido"); // V1-20: la cuenta existe y pasó la clave; el código no
    return { error: "Código incorrecto o vencido. Revisa la hora de tu teléfono y vuelve a intentar." };
  }
  await registrarEvento(quien, "ingreso");
  redirect(rutaSegura(form.get("siguiente")));
}

export async function salir() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) await registrarEvento(data.claims.sub as string, "salida");
  await supabase.auth.signOut();
  redirect("/login?aviso=salida");
}
