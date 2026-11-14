/**
 * Primer acceso (la pantalla Perfiles y accesos exige un admin que ya exista): crea la persona y su perfil.
 * Uso: npm run invitar -- correo@bia.hn "Nombre" [plus|estandar] [--admin] [--nube] [--sin-correo]
 *   --nube        usa el proyecto de Supabase en la nube (.env.nube) en vez del local (.env.local).
 *   --sin-correo  no manda invitación: crea la cuenta confirmada con una clave temporal que se muestra una sola vez en
 *                 esta terminal. Sirve mientras el proyecto no tenga un servidor de correo propio (Resend): el correo
 *                 de Supabase solo llega a miembros de la organización y con pocos envíos por hora.
 * Con invitación, el correo sale por el SMTP de Supabase (Mailpit en local: http://127.0.0.1:54324).
 * En los dos casos la persona configura su 2FA al entrar por primera vez.
 */
import { randomInt } from "node:crypto";
import { config } from "dotenv";
const args = process.argv.slice(2);
config({ path: args.includes("--nube") ? [".env.nube"] : [".env.local", ".env"], quiet: true, override: true });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/** 16 caracteres con letras y números (cumple la regla de claves: ≥ 10, letras y números). */
function claveTemporal() {
  const letras = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", digitos = "23456789", todo = letras + digitos;
  const c = [letras[randomInt(letras.length)], digitos[randomInt(digitos.length)], ...Array.from({ length: 14 }, () => todo[randomInt(todo.length)])];
  return c.sort(() => randomInt(3) - 1).join("");
}

async function main() {
  const esAdmin = args.includes("--admin");
  const sinCorreo = args.includes("--sin-correo");
  const [email, nombre, nivel = "estandar"] = args.filter((a) => !a.startsWith("--"));
  if (!email?.includes("@") || !nombre || !["plus", "estandar"].includes(nivel)) {
    throw new Error('Uso: npm run invitar -- correo@bia.hn "Nombre" [plus|estandar] [--admin] [--nube] [--sin-correo]');
  }
  const correo = email.toLowerCase();
  const clave = sinCorreo ? claveTemporal() : null;
  const { data, error } = clave
    ? await sb.auth.admin.createUser({ email: correo, password: clave, email_confirm: true, user_metadata: { nombre } })
    : await sb.auth.admin.inviteUserByEmail(correo, { data: { nombre } });
  if (error || !data.user) throw new Error(`${clave ? "alta" : "invitación"}: ${error?.message ?? "sin usuario"}`);
  const { error: e2 } = await sb.from("perfil").insert({ user_id: data.user.id, nombre, nivel, es_admin: esAdmin });
  if (e2) {
    await sb.auth.admin.deleteUser(data.user.id);
    throw new Error(`perfil: ${e2.message}`);
  }
  const donde = args.includes("--nube") ? "en la nube" : "en local";
  if (clave) {
    console.log(`Cuenta creada ${donde} para ${correo} (${nivel}${esAdmin ? " + admin" : ""}).`);
    console.log(`Clave temporal (se muestra una sola vez; compártela por un canal privado): ${clave}`);
    console.log("Al entrar se le pide configurar el 2FA con una app de autenticación.");
  } else {
    console.log(`Invitación enviada ${donde} a ${correo} (${nivel}${esAdmin ? " + admin" : ""}).`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
