/**
 * Código 2FA de los usuarios de prueba del Supabase local, para entrar a la app sin el teléfono.
 * Uso: npx tsx scripts/otp.ts [admin|estandar]   (por defecto admin)
 * Lee el secreto de PRUEBA_ADMIN_TOTP o PRUEBA_ESTANDAR_TOTP en .env.local y muestra solo el código, nunca el secreto.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { codigoTotp } from "../tests/totp";

const quien = (process.argv[2] ?? "admin").toLowerCase();
if (!["admin", "estandar"].includes(quien)) {
  console.error("Uso: npx tsx scripts/otp.ts [admin|estandar]");
  process.exit(1);
}
const secreto = process.env[`PRUEBA_${quien.toUpperCase()}_TOTP`];
if (!secreto) {
  console.error(`Falta PRUEBA_${quien.toUpperCase()}_TOTP en .env.local.`);
  process.exit(1);
}
const restan = 30 - Math.floor(Date.now() / 1000) % 30;
console.log(`${codigoTotp(secreto)}  (${quien}, vale ${restan} s más)`);
