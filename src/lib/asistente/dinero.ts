/** Formato de dólares para el costo de OpenRouter (G9). Pura y sin dependencias: la usan también componentes de cliente. */
const USD = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_FINO = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** «US$ 1,234.50»; montos menores de un centavo con 4 decimales («US$ 0.0012»). */
export const usd = (n: number) => `US$ ${n > 0 && n < 0.01 ? USD_FINO.format(n) : USD.format(n)}`;
