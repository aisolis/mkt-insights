/**
 * Secciones del análisis comercial (G9) para el dashboard: acumulado del año, detalle por producto del puente
 * precio–volumen–mezcla y rutas fuera de lo normal. Solo presentan lo que devuelven las funciones de 0014_analisis.sql.
 */
import { KpiCard } from "@/components/kpi-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fraccionSigno, motivoAtipica, rangoAcumulado } from "@/lib/dashboard/analisis";
import { capital, conteo, lempirasCompacto, periodoCorto, periodoLargo, precioKg, toneladas } from "@/lib/format";
import { variacionPct, type Acumulado, type Periodo, type Puente, type RutasAtipicas } from "@/lib/semantic/contracts";

/** Cuatro KPI del acumulado (enero..mes) contra el mismo tramo del año anterior (S24). */
export function AcumuladoKpis({ a }: { a: Acumulado }) {
  const contra = rangoAcumulado(a.anio - 1, a.mes);
  const v = (actual: number | null, base: number | null) => [{ pct: actual === null || base === null ? null : variacionPct(actual, base), contra }];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard titulo="Venta neta" valor={lempirasCompacto(a.venta_neta)} variaciones={v(a.venta_neta, a.venta_neta_cmp)} />
      <KpiCard titulo="Volumen" valor={toneladas(a.kg)} sufijo="t" variaciones={v(a.kg, a.kg_cmp)} />
      <KpiCard titulo="Precio promedio" valor={precioKg(a.precio_kg)} sufijo="/kg" variaciones={v(a.precio_kg, a.precio_kg_cmp)} />
      <KpiCard titulo="Clientes con compra" valor={conteo(a.clientes_con_compra)} variaciones={v(a.clientes_con_compra, a.clientes_con_compra_cmp)} />
    </div>
  );
}

const signo = (v: number) => (v > 0 ? `+${lempirasCompacto(v)}` : lempirasCompacto(v));
const tono = (v: number) => (v < 0 ? "text-red-700" : v > 0 ? "text-emerald-700" : "");

/** Productos que más movieron el efecto precio, con su precio por kg en ambos meses y su aporte a la mezcla. */
export function PuenteProductos({ p, periodo, comparado }: { p: Puente; periodo: Periodo; comparado: Periodo }) {
  if (!p.detalle_precio.length) return null;
  const mezcla = p.detalle_mezcla[0];
  return (
    <div className="space-y-2">
      <Table className="tabular-nums">
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right">L/kg {periodoCorto(comparado)}</TableHead>
            <TableHead className="text-right">L/kg {periodoCorto(periodo)}</TableHead>
            <TableHead className="text-right">Efecto precio</TableHead>
            <TableHead className="text-right">Efecto mezcla</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.detalle_precio.map((d) => (
            <TableRow key={d.art_codigo}>
              <TableCell className="max-w-56 truncate" title={`${d.descripcion} (${d.art_codigo})`}>{d.descripcion}</TableCell>
              <TableCell className="text-right">{precioKg(d.precio_kg_cmp)}</TableCell>
              <TableCell className="text-right">{precioKg(d.precio_kg)}</TableCell>
              <TableCell className={`text-right ${tono(d.efecto_precio)}`}>{signo(d.efecto_precio)}</TableCell>
              <TableCell className={`text-right ${tono(d.efecto_mezcla)}`}>{signo(d.efecto_mezcla)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-neutral-500">
        Los {p.detalle_precio.length} productos con más efecto precio. {mezcla && `El que más mueve la mezcla es ${mezcla.descripcion} (${signo(mezcla.efecto_mezcla)}). `}
        Volumen, precio y mezcla se calculan sobre {conteo(p.productos_comparables)} productos con kg en ambos meses; por producto se redondea cada cifra, así que no se re-suman al total.
      </p>
    </div>
  );
}

/** Rutas cuya variación contra el mes anterior se sale de su propia historia (S25), con el motivo en palabras. */
export function RutasAtipicasTabla({ r, periodo, anterior }: { r: RutasAtipicas; periodo: Periodo; anterior: Periodo }) {
  if (!r.hay_periodo || !r.hay_anterior)
    return <p className="py-6 text-center text-sm text-neutral-400">{capital(periodoLargo(anterior))} no tiene datos en esta versión: no hay contra qué comparar.</p>;
  if (!r.rutas.length)
    return (
      <p className="py-6 text-center text-sm text-neutral-400">
        {r.rutas_evaluadas
          ? `Ninguna de las ${conteo(r.rutas_evaluadas)} rutas evaluadas se salió de lo normal en ${periodoLargo(periodo)}.`
          : `No hay rutas con historia suficiente (6 meses o más) para evaluar ${periodoLargo(periodo)}.`}
      </p>
    );
  return (
    <Table className="tabular-nums">
      <TableHeader>
        <TableRow>
          <TableHead>Ruta</TableHead><TableHead>Canal</TableHead>
          <TableHead className="text-right">{capital(periodoCorto(periodo))}</TableHead>
          <TableHead className="text-right">{capital(periodoCorto(anterior))}</TableHead>
          <TableHead className="text-right">Cambio</TableHead>
          <TableHead>Por qué está aquí</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {r.rutas.map((x) => (
          <TableRow key={x.ruta}>
            <TableCell className="max-w-56 truncate align-top" title={x.ruta}>{x.ruta}</TableCell>
            <TableCell className="align-top">{x.canal}</TableCell>
            <TableCell className="text-right align-top">{lempirasCompacto(x.actual)}</TableCell>
            <TableCell className="text-right align-top">{lempirasCompacto(x.anterior)}</TableCell>
            <TableCell className={`text-right align-top ${tono(x.cambio)}`}>{fraccionSigno(x.cambio)}</TableCell>
            <TableCell className="min-w-72 whitespace-normal text-neutral-600">{motivoAtipica(x, anterior)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
