import { porcentaje } from "@/lib/format";

export type VariacionKpi = { pct: number | null; contra: string };

/** KPI con su variación contra el periodo comparado (primera) y contra la otra referencia (segunda, atenuada). */
export function KpiCard({ titulo, valor, sufijo, variaciones }: { titulo: string; valor: string; sufijo?: string; variaciones: VariacionKpi[] }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-sm text-neutral-500">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valor}{sufijo && <span className="ml-1 text-base font-normal text-neutral-500">{sufijo}</span>}</div>
      {variaciones.map((v, i) => (
        <div key={v.contra} className={`mt-1 text-xs tabular-nums ${i > 0 ? "opacity-70" : ""} ${tono(v.pct)}`}>
          {v.pct === null ? `sin base vs. ${v.contra}` : `${v.pct >= 0 ? "▲" : "▼"} ${porcentaje(v.pct)} vs. ${v.contra}`}
        </div>
      ))}
    </div>
  );
}

const tono = (pct: number | null) => (pct === null ? "text-neutral-500" : pct >= 0 ? "text-emerald-700" : "text-red-700");
