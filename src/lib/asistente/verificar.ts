/**
 * "La IA interpreta, no inventa datos": toda cifra que escriba el modelo debe salir de los resultados de las
 * consultas (resúmenes y hechos ya formateados). Se toleran redondeos: una cifra vale si coincide con alguna de
 * las consultas a la precisión más gruesa de las dos (8.35 ≈ 8.4, 7 ≈ 6.9; 7.2 ≠ 6.9). Se permiten años y
 * números chicos (≤ 31).
 */
const NUMERO = /\d[\d,]*(?:\.\d+)?/g;

export type Cifra = { valor: number; decimales: number };

function leer(s: string): Cifra {
  const limpio = s.replace(/,/g, "");
  return { valor: Number(limpio), decimales: limpio.includes(".") ? limpio.split(".")[1].length : 0 };
}

export function cifrasPermitidas(fuentes: unknown[]): Cifra[] {
  return [...JSON.stringify(fuentes).matchAll(NUMERO)].map((m) => leer(m[0]));
}

/** Coinciden si la diferencia cabe en media unidad del último decimal de la cifra menos precisa. */
function coincide(a: Cifra, b: Cifra) {
  const tolerancia = 0.5 * 10 ** -Math.min(a.decimales, b.decimales);
  return Math.abs(a.valor - b.valor) <= tolerancia + 1e-9;
}

/** Cifras del texto que no salen de las consultas. Vacío = verificado. */
export function cifrasNoVerificadas(texto: string, permitidas: Cifra[]): string[] {
  const malas: string[] = [];
  for (const m of texto.matchAll(NUMERO)) {
    const c = leer(m[0]);
    if (Number.isInteger(c.valor) && c.decimales === 0 && (c.valor <= 31 || (c.valor >= 2000 && c.valor <= 2100))) continue;
    if (!permitidas.some((p) => coincide(c, p))) malas.push(m[0]);
  }
  return [...new Set(malas)];
}
