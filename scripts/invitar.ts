/**
 * Primer acceso (la pantalla Perfiles y accesos exige un admin que ya exista): invita por correo y crea el perfil.
 * Uso: npm run invitar -- correo@bia.hn "Nombre" [plus|estandar] [--admin]
 * El correo sale por el SMTP de Supabase (Mailpit en local: http://127.0.0.1:54324; Resend en el proyecto alojado).
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const args = process.argv.slice(2);
  const esAdmin = args.includes("--admin");
  const [email, nombre, nivel = "estandar"] = args.filter((a) => !a.startsWith("--"));
  if (!email?.includes("@") || !nombre || !["plus", "estandar"].includes(nivel)) {
    throw new Error('Uso: npm run invitar -- correo@bia.hn "Nombre" [plus|estandar] [--admin]');
  }
  const { data, error } = await sb.auth.admin.inviteUserByEmail(email.toLowerCase(), { data: { nombre } });
  if (error || !data.user) throw new Error(`invitación: ${error?.message ?? "sin usuario"}`);
  const { error: e2 } = await sb.from("perfil").insert({ user_id: data.user.id, nombre, nivel, es_admin: esAdmin });
  if (e2) {
    await sb.auth.admin.deleteUser(data.user.id);
    throw new Error(`perfil: ${e2.message}`);
  }
  console.log(`Invitación enviada a ${email} (${nivel}${esAdmin ? " + admin" : ""}).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
