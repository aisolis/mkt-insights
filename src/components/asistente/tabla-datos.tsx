/**
 * Tabla de resultados al estilo de un explorador de datos: encabezado con el tipo de cada columna, filas
 * numeradas y conteo al pie. Recibe columnas y filas ya resueltas; `aFilas` convierte los datos crudos de una
 * consulta (lista de objetos, objeto plano u objeto de lados) a ese formato.
 */
export type Celda = string | number | boolean | null;
export type Datos = { columnas: string[]; filas: Celda[][] };

const NUM = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 2 });

const etiqueta = (k: string) => k.replace(/_/g, " ");
const esNumero = (v: Celda) => typeof v === "number";

/** Lista de objetos → columnas por clave; objeto de objetos → una fila por métrica y una columna por lado;
 * objeto plano → métrica y valor. */
export function aFilas(datos: unknown): Datos | null {
  if (Array.isArray(datos)) {
    const objetos = datos.filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && !Array.isArray(d));
    if (!objetos.length) return null;
    const columnas = [...new Set(objetos.flatMap(Object.keys))];
    return { columnas: columnas.map(etiqueta), filas: objetos.map((o) => columnas.map((c) => plano(o[c]))) };
  }
  if (datos && typeof datos === "object") {
    const entradas = Object.entries(datos as Record<string, unknown>);
    const lados = entradas.filter(([, v]) => v && typeof v === "object" && !Array.isArray(v));
    if (lados.length && lados.length === entradas.length) {
      const metricas = [...new Set(lados.flatMap(([, v]) => Object.keys(v as object)))];
      return {
        columnas: ["métrica", ...lados.map(([k]) => etiqueta(k))],
        filas: metricas.map((m) => [etiqueta(m), ...lados.map(([, v]) => plano((v as Record<string, unknown>)[m]))]),
      };
    }
    return { columnas: ["métrica", "valor"], filas: entradas.map(([k, v]) => [etiqueta(k), plano(v)]) };
  }
  return null;
}

function plano(v: unknown): Celda {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

function texto(v: Celda) {
  if (v === null) return "—";
  if (typeof v === "number") return NUM.format(v);
  if (typeof v === "boolean") return v ? "sí" : "no";
  return v;
}

/** Variaciones con signo (texto que empieza con + o −): verde o rojo. */
function tono(v: Celda) {
  if (typeof v !== "string") return "";
  if (v.startsWith("−")) return "text-red-700";
  if (v.startsWith("+")) return "text-emerald-700";
  return "";
}

export function TablaDatos({ datos, maxAlto = "max-h-96" }: { datos: Datos; maxAlto?: string }) {
  const { columnas, filas } = datos;
  // Una columna es numérica si sus valores son números o cifras con formato (L 1,234 · +5.2%).
  const numerica = columnas.map((_, i) => filas.length > 0 && filas.every((f) => f[i] === null || f[i] === "—" || esNumero(f[i]) || /^[+−-]?\s*(L\s)?[\d.,]+\s*(%|t|kg|M|k)?$/.test(String(f[i]))));
  return (
    <div>
      <div className={`overflow-auto rounded-lg border border-neutral-200 ${maxAlto}`}>
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-neutral-200">
              <th className="w-10 border-r border-neutral-100 px-2 py-2" />
              {columnas.map((c, i) => (
                <th key={c} className={`whitespace-nowrap border-r border-neutral-100 px-3 py-2 font-medium text-neutral-800 last:border-r-0 ${numerica[i] ? "text-right" : "text-left"}`}>
                  <span className="mr-1.5 align-[1px] font-mono text-[10px] font-normal text-neutral-400">{numerica[i] ? "1.2" : "ABC"}</span>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, j) => (
              <tr key={j} className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
                <td className="border-r border-neutral-100 px-2 py-1.5 text-center text-xs text-neutral-400">{j + 1}</td>
                {f.map((celda, i) => (
                  <td key={i} title={texto(celda)}
                    className={`border-r border-neutral-100 px-3 py-1.5 last:border-r-0 ${numerica[i] ? "whitespace-nowrap text-right" : "max-w-80 truncate"} ${tono(celda)}`}>
                    {texto(celda)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">{filas.length} {filas.length === 1 ? "fila" : "filas"}</p>
    </div>
  );
}
