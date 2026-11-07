/**
 * Corre el banco de preguntas en modo modelo contra el Supabase local y la llave de OpenRouter de .env.local.
 * Reporta, por pregunta: si quedó el texto del modelo o se cayó a la redacción automática (cifras no
 * verificadas), qué herramientas usó, documentos citados y tiempo. Gasta tokens: no corre en `npm test`.
 * Uso: npm run banco:modelo [-- "pregunta extra" ...]
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { configModelo } from "../src/lib/asistente/modelo";
import { responder } from "../src/lib/asistente/responder";
import type { Contexto } from "../src/lib/asistente/tipos";
import { aVector, configEmbeddings, embeber } from "../src/lib/conocimiento/embeddings";
import { Encontrado } from "../src/lib/conocimiento/tipos";
import { leerParams } from "../src/lib/dashboard/params";
import { crearConsultas, type Rpc } from "../src/lib/semantic/consultas";
import type { VersionVigente } from "../src/lib/semantic/contracts";

const BANCO = [
  "¿Dónde se concentra la caída de septiembre?",
  "¿Por qué cayó la venta neta vs. agosto?",
  "¿Qué rutas explican la caída?",
  "¿Cómo le fue a la marca ORO en septiembre?",
  "Variación por canal en septiembre vs. el año anterior",
  "¿Cuánto vendimos en agosto 2026?",
  "Evolución mensual de 2025",
  "¿Qué productos cayeron más en Mayoreo?",
  "¿Bajó el número de facturas o el ticket?",
  "Variación por zona",
  "¿Cuál es nuestro market share en café?",
  "¿Cuánto vamos a vender en noviembre?",
  "¿Cuántas visitas hicimos en la ruta 127?",
  "¿Cuántos pedidos hubo en septiembre?",
  "¿Qué clientes dejaron de comprar?",
];

async function main() {
  const modelo = configModelo();
  if (!modelo) throw new Error("Falta OPENROUTER_API_KEY en .env.local");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const rpc: Rpc = async (fn, args, schema) => {
    const { data, error } = await sb.schema("ventas").rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return schema.parse(data);
  };
  const emb = configEmbeddings();
  const documentos = async (consulta: string) => {
    const p_embedding = emb ? aVector((await embeber([consulta], emb))[0]) : null;
    const { data, error } = await sb.schema("conocimiento").rpc("buscar", { p_texto: consulta, p_embedding, p_limite: 8 });
    if (error) throw new Error(error.message);
    return z.array(Encontrado).parse(data);
  };
  const fuente = crearConsultas(rpc);
  const version = (await fuente.versionVigente()) as VersionVigente;
  const ctx: Contexto = { fuente, version, estado: leerParams({}, version.metadatos.periodos), documentos };
  const preguntas = process.argv.slice(2).length ? process.argv.slice(2) : BANCO;
  console.log(`Modelo ${modelo.modelo} · embeddings ${emb?.modelo ?? "no"} · v${version.version}\n`);

  let conModelo = 0, respaldo = 0, bloqueadas = 0, fallas = 0;
  for (const p of preguntas) {
    const t0 = Date.now();
    try {
      const r = await responder(p, [], ctx, modelo);
      const seg = ((Date.now() - t0) / 1000).toFixed(1);
      const cayo = r.evidencia.advertencias.find((a) => /modelo/.test(a));
      if (r.estado === "fuera_de_alcance") bloqueadas++;
      else if (r.modo === "modelo" && !cayo) conModelo++;
      else respaldo++;
      console.log(`■ ${p}  [${r.estado} · ${r.modo}${cayo ? " · RESPALDO" : ""} · ${seg} s]`);
      console.log(`  herramientas: ${r.consultas.map((c) => c.herramienta).join(", ") || "—"}${r.contexto.length ? ` · citas: ${r.contexto.map((c) => `${c.id} ${c.titulo} p.${c.pagina}`).join("; ")}` : ""}`);
      if (cayo) console.log(`  aviso: ${cayo}`);
      console.log(`  texto: ${r.texto}`);
      if (r.hipotesis.length) console.log(`  hipótesis: ${r.hipotesis.join(" | ")}`);
      console.log("");
    } catch (e) {
      fallas++;
      console.log(`■ ${p}  [ERROR] ${e instanceof Error ? e.message : e}\n`);
    }
  }
  console.log(`Resumen: ${conModelo} con texto del modelo · ${respaldo} con redacción automática · ${bloqueadas} fuera de alcance · ${fallas} errores`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
