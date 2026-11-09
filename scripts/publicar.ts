/**
 * Publica una carga validada como la siguiente versión (lo normal es hacerlo desde "Cargas y versiones").
 * Uso: npx tsx scripts/publicar.ts [carga_id] [--notas "texto"] [--mes-completo]
 * Sin carga_id publica la última carga validada. Aprueba y publica como "servicio" (queda así en el historial; desde la
 * app son dos pasos de personas con rol, V1-07). La función ventas.publicar hace todo en una transacción: versión nueva =
 * composición vigente con los meses de la carga reemplazados (S8), fecha de corte, metadatos, conciliada_bi = false.
 * --mes-completo declara cerrado el último mes. No revisa alertas: eso lo hace la app.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const args = process.argv.slice(2);
  const iNotas = args.indexOf("--notas");
  const notas = iNotas >= 0 ? args[iNotas + 1] : null;
  let cargaId = args.find((a, i) => !a.startsWith("--") && i !== iNotas + 1);

  if (!cargaId) {
    const { data, error } = await sb.schema("ventas").from("carga").select("id").eq("estado", "validada").order("creado_en", { ascending: false }).limit(1).single();
    if (error) throw new Error(`no hay cargas validadas para publicar (${error.message})`);
    cargaId = data.id as string;
  }

  const ap = await sb.schema("ventas").rpc("aprobar_carga", {
    p_carga: cargaId, p_usuario: null, p_rol: "servicio", p_ultimo_mes_cerrado: args.includes("--mes-completo"), p_alertas: [], p_motivo: notas,
  });
  if (ap.error) throw ap.error;
  const { data, error } = await sb.schema("ventas").rpc("publicar", { p_carga: cargaId, p_notas: notas, p_rol: "servicio" });
  if (error) throw error;
  console.log(data);
}

main().catch((e) => { console.error(e); process.exit(1); });
