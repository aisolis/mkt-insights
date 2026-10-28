export function KpiCard({ titulo, valor, variacion, sufijo }: { titulo: string; valor: string; variacion: number | null; sufijo?: string }) {
  const up = (variacion ?? 0) >= 0;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-sm text-neutral-500">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold">{valor}{sufijo && <span className="ml-1 text-base font-normal text-neutral-500">{sufijo}</span>}</div>
      {variacion !== null && (
        <div className={`mt-1 text-xs ${up ? "text-emerald-700" : "text-red-700"}`}>
          {up ? "▲" : "▼"} {Math.abs(variacion).toFixed(1)}% vs. periodo anterior
        </div>
      )}
    </div>
  );
}
