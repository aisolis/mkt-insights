import Link from "next/link";
import { CanalChart } from "@/components/dashboard/canal-chart";
import { Filtros } from "@/components/dashboard/filtros";
import { SerieChart, type PuntoSerie } from "@/components/dashboard/serie-chart";
import { KpiCard } from "@/components/kpi-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { advertencias, leerParams, periodoComparado, queryString } from "@/lib/dashboard/params";
import { capital, conteo, fechaCorta, lempirasCompacto, periodoCorto, periodoLargo, precioKg, toneladas } from "@/lib/format";
import { variacionPct, type Filtros as FiltrosT, type Kpi, type VersionVigente } from "@/lib/semantic/contracts";
import { kpiPeriodo, serieMensual, topContribuyentes, variacionPorDimension, versionVigente } from "@/lib/semantic/queries";

export default async function Inicio(props: PageProps<"/">) {
  const version = await versionVigente();
  if (!version) return <SinVersion />;

  const meta = version.metadatos;
  const estado = leerParams(await props.searchParams, meta.periodos);
  const { periodo, filtros } = estado;
  const cmp = periodoComparado(periodo, estado.comparar);
  const otra = periodoComparado(periodo, estado.comparar === "anio" ? "anterior" : "anio");
  const v = version.version;

  // Todas las cifras salen de las funciones SQL de la versión publicada; aquí solo se presentan.
  const [kpi, kpiOtra, canales, rutas, serie, serieAnt] = await Promise.all([
    kpiPeriodo({ version: v, periodo, comparar: cmp, filtros }),
    kpiPeriodo({ version: v, periodo, comparar: otra, filtros }),
    variacionPorDimension({ version: v, dimension: "canal", periodo, comparar: cmp, filtros }),
    topContribuyentes({ version: v, periodo, comparar: cmp, filtros, limite: 10 }),
    serieMensual({ version: v, anio: periodo.anio, filtros }),
    serieMensual({ version: v, anio: periodo.anio - 1, filtros }),
  ]);

  const qs = queryString(estado);
  const contra = periodoLargo(cmp);
  const contraOtra = periodoLargo(otra);
  const totalCanal = canales.reduce((s, f) => s + f.variacion, 0);
  const avisos = advertencias(periodo, cmp, meta.periodos);
  const puntos: PuntoSerie[] = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((mes) => ({
      mes,
      actual: serie.find((p) => p.mes === mes)?.venta_neta ?? null,
      anterior: serieAnt.find((p) => p.mes === mes)?.venta_neta ?? null,
      parcial: meta.periodos.some((p) => p.anio === periodo.anio && p.mes === mes && !p.cerrado),
    }))
    .filter((p) => p.actual !== null || p.anterior !== null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Desempeño comercial</h1>
        <p className="text-sm text-neutral-500">{subtitulo(periodo, cmp, filtros, meta.producto)}</p>
      </div>

      <Filtros estado={estado} periodos={meta.periodos} opciones={meta} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard titulo="Venta neta" valor={lempirasCompacto(kpi.venta_neta)} variaciones={vars(kpi, kpiOtra, "venta_neta", contra, contraOtra)} />
        <KpiCard titulo="Volumen" valor={toneladas(kpi.kg)} sufijo="t" variaciones={vars(kpi, kpiOtra, "kg", contra, contraOtra)} />
        <KpiCard titulo="Precio promedio" valor={precioKg(kpi.precio_kg)} sufijo="/kg" variaciones={vars(kpi, kpiOtra, "precio_kg", contra, contraOtra)} />
        <KpiCard titulo="Clientes con compra" valor={conteo(kpi.clientes_con_compra)} variaciones={vars(kpi, kpiOtra, "clientes_con_compra", contra, contraOtra)} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Seccion titulo={`Venta neta mensual ${periodo.anio}`} detalle={`L millones · línea punteada: ${periodo.anio - 1}`}
          accion={<Preguntar qs={qs} sobre="serie" />}>
          <SerieChart datos={puntos} anio={periodo.anio} mesSeleccionado={periodo.mes} />
        </Seccion>
        <Seccion titulo={`Variación por canal vs. ${contra}`} detalle={`Total: ${lempirasCompacto(totalCanal)}`}
          accion={<Preguntar qs={qs} sobre="canal" />}>
          <CanalChart filas={canales} />
        </Seccion>
      </div>

      <Seccion titulo="Rutas que más contribuyen a la variación" detalle="Ruta × canal, ordenadas por el tamaño de la variación"
        accion={<div className="flex gap-4"><Preguntar qs={qs} sobre="rutas" /><a href={`/api/exportar/rutas?${qs}`} className="text-xs text-neutral-600 underline">Exportar</a></div>}>
        <Table className="tabular-nums">
          <TableHeader>
            <TableRow>
              <TableHead>Ruta</TableHead><TableHead>Canal</TableHead>
              <TableHead className="text-right">{capital(periodoCorto(periodo))}</TableHead>
              <TableHead className="text-right">{capital(periodoCorto(cmp))}</TableHead>
              <TableHead className="text-right">Variación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rutas.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-6 text-center text-neutral-400">Sin ventas en {periodoLargo(periodo)} ni en {contra} con estos filtros.</TableCell></TableRow>
            )}
            {rutas.map((r) => (
              <TableRow key={`${r.ruta}|${r.canal}`}>
                <TableCell className="max-w-72 truncate" title={r.ruta}>{r.ruta}</TableCell>
                <TableCell>{r.canal}</TableCell>
                <TableCell className="text-right">{lempirasCompacto(r.actual)}</TableCell>
                <TableCell className="text-right">{lempirasCompacto(r.anterior)}</TableCell>
                <TableCell className={`text-right ${r.variacion < 0 ? "text-red-700" : "text-emerald-700"}`}>{lempirasCompacto(r.variacion)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Seccion>

      <Pie version={version} kpi={kpi} avisos={avisos} />
    </div>
  );
}

function vars(kpi: Kpi, otra: Kpi, campo: "venta_neta" | "kg" | "precio_kg" | "clientes_con_compra", contra: string, contraOtra: string) {
  const pct = (k: Kpi) => {
    const actual = k[campo], base = k[`${campo}_cmp`];
    return actual === null || base === null ? null : variacionPct(actual, base);
  };
  return [{ pct: pct(kpi), contra }, { pct: pct(otra), contra: contraOtra }];
}

function subtitulo(periodo: { anio: number; mes: number }, cmp: { anio: number; mes: number }, f: FiltrosT, productos: VersionVigente["metadatos"]["producto"]) {
  const partes = [`${capital(periodoLargo(periodo))} vs. ${periodoLargo(cmp)}`, "Honduras", f.canal ?? "todos los canales"];
  if (f.ruta) partes.push(`ruta ${f.ruta}`);
  if (f.marca) partes.push(`marca ${f.marca}`);
  if (f.art_codigo) partes.push(productos.find((p) => p.codigo === f.art_codigo)?.descripcion ?? `producto ${f.art_codigo}`);
  return partes.join(" · ");
}

function Seccion({ titulo, detalle, accion, children }: { titulo: string; detalle?: string; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{titulo}</h2>
          {detalle && <p className="text-xs text-neutral-500 tabular-nums">{detalle}</p>}
        </div>
        {accion}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Abre el asistente con los mismos filtros (G4 los hereda de la URL). */
function Preguntar({ qs, sobre }: { qs: string; sobre: string }) {
  return <Link href={`/asistente?${qs}&sobre=${sobre}`} className="shrink-0 text-xs text-neutral-600 underline">Preguntar al asistente</Link>;
}

function Pie({ version, kpi, avisos }: { version: VersionVigente; kpi: Kpi; avisos: string[] }) {
  return (
    <footer className="space-y-1 text-xs text-neutral-500">
      <p className="tabular-nums">
        Fuente: cubo de ventas BIA · {version.archivo} · versión v{version.version} publicada {fechaCorta(version.publicado_en)} · cobertura {kpi.rutas_con_venta}/{kpi.rutas_total} rutas con venta en el periodo
      </p>
      {!version.conciliada_bi && <p className="text-amber-700">Cifras verificadas contra el Excel exportado, todavía no conciliadas con el reporte de BI.</p>}
      {avisos.map((a) => <p key={a} className="text-amber-700">{a}</p>)}
    </footer>
  );
}

function SinVersion() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
      Todavía no hay una versión publicada. Carga el Excel (<code>npm run ingest</code>) y publícalo (<code>npm run publicar</code>).
    </div>
  );
}
