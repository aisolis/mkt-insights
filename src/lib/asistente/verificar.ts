/**
 * "La IA interpreta, no inventa datos": toda cifra que escriba el modelo debe aparecer tal cual en los resultados
 * de las consultas (resúmenes y hechos ya formateados). Se permiten años, días y números chicos (≤ 31).
 */
const NUMERO = /\d[\d,]*(?:\.\d+)?/g;

const normal = (s: string) => s.replace(/,/g, "").replace(/\.0+$/, "");

export function cifrasPermitidas(fuentes: unknown[]): Set<string> {
  const out = new Set<string>();
  const texto = JSON.stringify(fuentes);
  for (const m of texto.matchAll(NUMERO)) out.add(normal(m[0]));
  return out;
}

/** Cifras del texto que no salen de las consultas. Vacío = verificado. */
export function cifrasNoVerificadas(texto: string, permitidas: Set<string>): string[] {
  const malas: string[] = [];
  for (const m of texto.matchAll(NUMERO)) {
    const n = normal(m[0]);
    if (permitidas.has(n)) continue;
    const v = Number(n);
    if (Number.isInteger(v) && (v <= 31 || (v >= 2000 && v <= 2100))) continue;
    malas.push(m[0]);
  }
  return [...new Set(malas)];
}
