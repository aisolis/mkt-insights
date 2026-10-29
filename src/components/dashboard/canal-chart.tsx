"use client";
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { lempiras, lempirasCompacto } from "@/lib/format";
import type { VariacionFila } from "@/lib/semantic/contracts";

const config = { variacion: { label: "Variación", color: "var(--chart-3)" } } satisfies ChartConfig;
const ROJO = "#dc2626", VERDE = "#059669";

/** Barras horizontales de variación por canal, de la mayor caída al mayor aumento. */
export function CanalChart({ filas }: { filas: VariacionFila[] }) {
  const datos = filas.filter((f) => f.actual !== 0 || f.anterior !== 0);
  // Dominio con aire a ambos lados del cero para que la etiqueta quepa en el extremo exterior de cada barra.
  const lo = Math.min(0, ...datos.map((f) => f.variacion)), hi = Math.max(0, ...datos.map((f) => f.variacion));
  const aire = (hi - lo || 1) * 0.3;
  const dominio = [lo < 0 ? lo - aire : 0, hi > 0 ? hi + aire : 0];
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(120, datos.length * 34 + 16) }}>
      <BarChart data={datos} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
        <XAxis type="number" hide domain={dominio} />
        <YAxis type="category" dataKey="valor" tickLine={false} axisLine={false} width={104} interval={0} />
        <ReferenceLine x={0} stroke="var(--border)" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel formatter={(_v, _n, item) => {
          const f = item.payload as VariacionFila;
          return <span className="tabular-nums">{f.valor}: {lempiras(f.actual)} vs. {lempiras(f.anterior)}</span>;
        }} />} />
        <Bar dataKey="variacion" radius={0} maxBarSize={22} isAnimationActive={false}>
          {datos.map((f) => <Cell key={f.valor} fill={f.variacion < 0 ? ROJO : VERDE} />)}
          <LabelList dataKey="variacion" content={Etiqueta} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Etiqueta en el extremo exterior de la barra: a la izquierda si cae, a la derecha si sube. */
function Etiqueta(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) {
  const x = Number(props.x), y = Number(props.y), w = Number(props.width), h = Number(props.height), v = Number(props.value);
  if ([x, y, w, h, v].some(Number.isNaN)) return null;
  const izq = Math.min(x, x + w), der = Math.max(x, x + w);
  const negativo = v < 0;
  return (
    <text x={negativo ? izq - 6 : der + 6} y={y + h / 2} dominantBaseline="central" textAnchor={negativo ? "end" : "start"}
      className="fill-neutral-700 tabular-nums" fontSize={11}>
      {lempirasCompacto(v)}
    </text>
  );
}
