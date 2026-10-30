/**
 * Ingesta desde disco del XLSX del cubo → ventas.hecho. Para archivos grandes (la exportación completa de 128 MB)
 * que no pasan por la app; los archivos del mes se suben desde "Cargas y versiones".
 * Uso: npx tsx scripts/ingest.ts [ruta.xlsx]   (después: publicar desde la app o con scripts/publicar.ts)
 * Requiere SUPABASE_SERVICE_ROLE_KEY. La lógica es la misma de la app (src/lib/cargas/ingesta.ts).
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cerrarCarga, fallarCarga, ingerirXlsx } from "../src/lib/cargas/ingesta";

const XLSX = process.argv[2] ?? process.env.XLSX_PATH!;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function sha256(path: string) {
  return new Promise<string>((res, rej) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej);
  });
}

async function main() {
  const hash = await sha256(XLSX);
  const bytes = statSync(XLSX).size;
  console.log("archivo", XLSX, bytes, "bytes", hash);

  const { data: existente } = await sb.schema("ventas").from("carga").select("id,estado").eq("sha256", hash).neq("estado", "con_errores").maybeSingle();
  if (existente) { console.log("ya cargado:", existente); return; } // idempotencia por hash (AT07)

  const { data: carga, error } = await sb.schema("ventas").from("carga")
    .insert({ nombre_archivo: XLSX.split(/[\\/]/).pop(), sha256: hash, bytes, estado: "procesando" }).select().single();
  if (error) throw error;
  try {
    const c = await ingerirXlsx(sb, carga.id, XLSX, (n) => { if (n % 50000 === 0) console.log("cargadas", n); });
    await cerrarCarga(sb, carga.id, c);
    console.log({ carga: carga.id, ...c });
    console.log("Control de la exportación completa (analisis/perfil.json): 1073421 cargadas · 5744 duplicados · 153 discrepancias · 23994 seriales");
  } catch (e) {
    await fallarCarga(sb, carga.id, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
