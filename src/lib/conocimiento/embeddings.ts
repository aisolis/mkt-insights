/**
 * Embeddings por OpenRouter (solo servidor). Opcionales: sin llave la búsqueda es solo de texto en español y
 * `npm run conocimiento:embeddings` completa los fragmentos pendientes cuando haya llave.
 * El modelo debe dar vectores de 1,024 dimensiones (columna vector(1024)); por defecto baai/bge-m3, multilingüe.
 */
export const DIMENSIONES = 1024;

export type ConfigEmbeddings = { apiKey: string; modelo: string; url?: string; fetch?: typeof fetch };

export function configEmbeddings(): ConfigEmbeddings | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  return apiKey ? { apiKey, modelo: process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || "baai/bge-m3" } : null;
}

export async function embeber(textos: string[], cfg: ConfigEmbeddings): Promise<number[][]> {
  const vectores: number[][] = [];
  for (let i = 0; i < textos.length; i += 64) {
    const lote = textos.slice(i, i + 64);
    const res = await (cfg.fetch ?? fetch)(cfg.url ?? "https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "X-Title": "BIA Foresight" },
      body: JSON.stringify({ model: cfg.modelo, input: lote }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`OpenRouter embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const datos = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
    if (datos.length !== lote.length) throw new Error(`OpenRouter embeddings: llegaron ${datos.length} de ${lote.length}`);
    for (const d of datos) {
      if (d.embedding.length !== DIMENSIONES) throw new Error(`El modelo ${cfg.modelo} da ${d.embedding.length} dimensiones; se esperan ${DIMENSIONES}.`);
      vectores.push(d.embedding);
    }
  }
  return vectores;
}

/** Formato de pgvector para enviarlo por PostgREST. */
export const aVector = (v: number[]) => `[${v.join(",")}]`;
