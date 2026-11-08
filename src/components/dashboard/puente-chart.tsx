"use client";
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { lempiras, lempirasCompacto } from "@/lib/format";
import type { PasoPuente } from "@/lib/dashboard/analisis";

const config = { rango: { label: "Efecto", color: "var(--chart-3)" } } satisfies ChartConfig;
const ROJO = "#dc2626", VERDE = "#059669";

type Fila = { nombre: string; valor: number; rango: [number, number]; explicacion: string; total: boolean };

/**
 * Cascada horizontal de la variación de venta neta: cada efecto arranca donde terminó el anterior y la última barra
 * es la variación total (S23). Todo en lempiras de variación, así el eje no se corta.
 */
export function PuenteChart({ pasos, total }: { pasos: PasoPuente[]; total: number }) {
  // Cada barra va del acumulado de los renglones anteriores al acumulado con el suyo.
  const filas: Fila[] = pasos.map((p, i) => {
    const inicio = pasos.slice(0, i).reduce((s, x) => s + x.valor, 0);
    return { nombre: p.nombre, valor: p.valor, rango: [inicio, inicio + p.valor], explicacion: p.explicacion, total: false };
  });
  filas.push({ nombre: "Variación total", valor: total, rango: [0, total], explicacion: "Suma de los renglones anteriores, al centavo.", total: true });
  const extremos = filas.flatMap((f) => f.rango);
  const lo = Math.min(0, ...extremos), hi = Math.max(0, ...extremos);
  const aire = (hi - lo || 1) * 0.3;
  const dominio = [lo < 0 ? lo - aire : 0, hi > 0 ? hi + aire : 0];
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: filas.length * 34 + 16 }}>
      <BarChart data={filas} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
        <XAxis type="number" hide domain={dominio} />
        <YAxis type="category" dataKey="nombre" tickLine={false} axisLine={false} width={124} interval={0} />
        <ReferenceLine x={0} stroke="var(--border)" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel formatter={(_v, _n, item) => {
          const f = item.payload as Fila;
          return <span className="max-w-64 tabular-nums">{f.nombre}: {lempiras(f.valor)}. {f.explicacion}</span>;
        }} />} />
        <Bar dataKey="rango" radius={0} maxBarSize={22} isAnimationActive={false}>
          {filas.map((f) => <Cell key={f.nombre} fill={f.total ? "var(--foreground)" : f.valor < 0 ? ROJO : VERDE} />)}
          <LabelList dataKey="valor" content={Etiqueta} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Etiqueta en el extremo exterior de la barra: a la izquierda si resta, a la derecha si suma. */
function Etiqueta(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) {
  const x = Number(props.x), y = Number(props.y), w = Number(props.width), h = Number(props.height), v = Number(props.value);
  if ([x, y, w, h, v].some(Number.isNaN)) return null;
  const izq = Math.min(x, x + w), der = Math.max(x, x + w);
  const negativo = v < 0;
  return (
    <text x={negativo ? izq - 6 : der + 6} y={y + h / 2} dominantBaseline="central" textAnchor={negativo ? "end" : "start"}
      className="fill-neutral-700 tabular-nums" fontSize={11}>
      {v > 0 ? "+" : ""}{lempirasCompacto(v)}
    </text>
  );
}
