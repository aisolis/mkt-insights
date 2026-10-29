"use client";
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { capital, lempiras, mesCorto } from "@/lib/format";

export type PuntoSerie = { mes: number; actual: number | null; anterior: number | null; parcial: boolean };

/** Venta neta mensual del año (barras, L millones) con el año anterior como referencia (línea). */
export function SerieChart({ datos, anio, mesSeleccionado }: { datos: PuntoSerie[]; anio: number; mesSeleccionado: number }) {
  const config = {
    actual: { label: String(anio), color: "var(--chart-2)" },
    anterior: { label: String(anio - 1), color: "var(--chart-1)" },
  } satisfies ChartConfig;
  const filas = datos.map((d) => ({
    ...d,
    mesLabel: capital(mesCorto(d.mes)),
    actualM: d.actual === null ? null : d.actual / 1e6,
    anteriorM: d.anterior === null ? null : d.anterior / 1e6,
  }));
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <ComposedChart data={filas} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="mesLabel" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => v.toFixed(0)} />
        <ChartTooltip content={<ChartTooltipContent formatter={(_v, nombre, item) => {
          const p = item.payload as (typeof filas)[number];
          const v = nombre === "actualM" ? p.actual : p.anterior;
          const etiqueta = nombre === "actualM" ? anio : anio - 1;
          return v === null ? null : <span className="tabular-nums">{etiqueta}: {lempiras(v)}{nombre === "actualM" && p.parcial ? " (parcial)" : ""}</span>;
        }} />} />
        <Bar dataKey="actualM" radius={0} isAnimationActive={false}>
          {filas.map((d) => (
            <Cell key={d.mes} fill={d.mes === mesSeleccionado ? "var(--foreground)" : "var(--color-actual)"} fillOpacity={d.parcial ? 0.35 : 1} />
          ))}
          <LabelList dataKey="actualM" position="top" className="fill-neutral-600" fontSize={10} formatter={(v: unknown) => (typeof v === "number" ? v.toFixed(1) : "")} />
        </Bar>
        <Line dataKey="anteriorM" type="monotone" stroke="var(--color-anterior)" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
      </ComposedChart>
    </ChartContainer>
  );
}
