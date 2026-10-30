/**
 * Calcula los embeddings que falten en conocimiento.fragmento (documentos subidos sin OPENROUTER_API_KEY o con el
 * servicio caído). Sin llave no hace nada: la búsqueda sigue funcionando solo por texto.
 * Uso: npm run conocimiento:embeddings
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { createClient } from "@supabase/supabase-js";
import { configEmbeddings } from "../src/lib/conocimiento/embeddings";
import { completarEmbeddings } from "../src/lib/conocimiento/procesar";

async function main() {
  const emb = configEmbeddings();
  if (!emb) {
    console.log("Sin OPENROUTER_API_KEY: no se calculan embeddings (la búsqueda queda solo por texto).");
    return;
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const n = await completarEmbeddings(sb, emb);
  console.log(`${n} fragmentos con embedding nuevo (${emb.modelo}).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
