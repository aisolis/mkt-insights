import Link from "next/link";
import { AcumuladoKpis, PuenteProductos, RutasAtipicasTabla } from "@/components/dashboard/analisis";
import { CanalChart } from "@/components/dashboard/canal-chart";
import { Filtros } from "@/components/dashboard/filtros";
import { PuenteChart } from "@/components/dashboard/puente-chart";
import { SerieChart, type PuntoSerie } from "@/components/dashboard/serie-chart";
import { KpiCard } from "@/components/kpi-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { advertenciasAcumulado, mesAnterior, pasosPuente, rangoAcumulado } from "@/lib/dashboard/analisis";
import { advertencias, leerParams, periodoComparado, queryString } from "@/lib/dashboard/params";
import { capital, conteo, fechaLocal, lempirasCompacto, periodoCorto, periodoLargo, precioKg, toneladas } from "@/lib/format";
import { textoAlcance, variacionPct, type Filtros as FiltrosT, type Kpi, type VersionVigente } from "@/lib/semantic/contracts";
import {
  acumuladoAnio, kpiPeriodo, puentePrecioVolumenMezcla, rutasAtipicas, serieMensual, variacionPorDimension, versionVigente,
} from "@/lib/semantic/queries";
import { requerirAcceso } from "@/lib/auth/acceso";

export default async function Inicio(props: PageProps<"/">) {
  await requerirAcceso(); // el layout no se vuelve a ejecutar en cada navegación
  const version = await versionVigente();
  if (!version) return <SinVersion />;

  const meta = version.metadatos;
  const estado = leerParams(await props.searchParams, meta.periodos);
  const { periodo, filtros } = estado;
  const cmp = periodoComparado(periodo, estado.comparar);
  const otra = periodoComparado(periodo, estado.comparar === "anio" ? "anterior" : "anio");
  const v = version.version;

  // Todas las cifras salen de las funciones SQL de la versión publicada; aquí solo se presentan.
  const anterior = mesAnterior(periodo);
  const [kpi, kpiOtra, canales, rutas, serie, serieAnt, puente, acumulado, atipicas] = await Promise.all([
    kpiPeriodo({ version: v, periodo, comparar: cmp, filtros }),
    kpiPeriodo({ version: v, periodo, comparar: otra, filtros }),
    variacionPorDimension({ version: v, dimension: "canal", periodo, comparar: cmp, filtros }),
    // Por ruta completa (todas sus ventas, en cualquier canal): la misma cifra que «Rutas fuera de lo normal» y el resumen del mes.
    variacionPorDimension({ version: v, dimension: "ruta", periodo, comparar: cmp, filtros }),
    serieMensual({ version: v, anio: periodo.anio, filtros }),
    serieMensual({ version: v, anio: periodo.anio - 1, filtros }),
    // G9: análisis comercial (0014_analisis.sql).
    puentePrecioVolumenMezcla({ version: v, periodo, comparar: cmp, filtros, limite: 5 }),
    acumuladoAnio({ version: v, periodo, filtros }),
    rutasAtipicas({ version: v, periodo, filtros, limite: 10 }),
  ]);

  const qs = queryString(estado);
  const contra = periodoLargo(cmp);
  const contraOtra = periodoLargo(otra);
  const totalCanal = canales.reduce((s, f) => s + f.variacion, 0);
  const principales = [...rutas].sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion) || a.valor.localeCompare(b.valor)).slice(0, 10);
  // Sin datos del mes comparado no hay variación que explicar: un solo aviso arriba en vez de barras contra L 0.
  const hayDatos = (p: { anio: number; mes: number }) => meta.periodos.some((m) => m.anio === p.anio && m.mes === p.mes);
  const sinBase = !hayDatos(cmp);
  const alternativa = sinBase && hayDatos(otra) ? otra : null;
  const avisos = [...advertencias(periodo, cmp, meta.periodos), ...advertenciasAcumulado(acumulado, meta.periodos)]
    .filter((a) => !(sinBase && a.startsWith(`${capital(periodoLargo(cmp))} no tiene datos`)));
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
        <p className="text-sm text-neutral-500">{subtitulo(periodo, cmp, filtros, meta.producto, !!version.alcance?.canal?.length)}</p>
        {textoAlcance(version.alcance) && (
          <p role="note" className="max-w-prose text-sm text-amber-900">
            Tu acceso cubre solo {textoAlcance(version.alcance)}: todas las cifras, totales y comparaciones de esta pantalla son de ese ámbito, no de toda BIA.
          </p>
        )}
      </div>

      <Filtros estado={estado} periodos={meta.periodos} opciones={meta} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard titulo="Venta neta" valor={lempirasCompacto(kpi.venta_neta)} variaciones={vars(kpi, kpiOtra, "venta_neta", contra, contraOtra)} />
        <KpiCard titulo="Volumen" valor={toneladas(kpi.kg)} sufijo="t" variaciones={vars(kpi, kpiOtra, "kg", contra, contraOtra)} />
        <KpiCard titulo="Precio promedio" valor={precioKg(kpi.precio_kg)} sufijo="/kg" variaciones={vars(kpi, kpiOtra, "precio_kg", contra, contraOtra)} />
        <KpiCard titulo="Clientes con compra" valor={conteo(kpi.clientes_con_compra)} variaciones={vars(kpi, kpiOtra, "clientes_con_compra", contra, contraOtra)} />
      </div>

      {sinBase && (
        <section role="note" aria-labelledby="sin-base" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <h2 id="sin-base" className="font-medium">No hay contra qué comparar</h2>
          <p className="mt-1 max-w-prose">
            {capital(periodoLargo(cmp))} no tiene datos en esta versión (la historia empieza en {periodoLargo(meta.periodos[0])}), así que no se muestran la variación
            por canal, las rutas que más contribuyen ni el puente de precio, volumen y mezcla.
            {alternativa && <> <Link href={`/?${queryString({ ...estado, comparar: estado.comparar === "anio" ? "anterior" : "anio" })}`} className="font-medium underline underline-offset-2">Comparar con {periodoLargo(alternativa)}</Link>.</>}
          </p>
        </section>
      )}

      <Seccion titulo={`Acumulado del año · ${rangoAcumulado(periodo.anio, periodo.mes)}`}
        detalle={`Enero a ${periodoLargo(periodo)} contra el mismo tramo de ${periodo.anio - 1}`}
        accion={<Preguntar qs={qs} sobre="acumulado" />}>
        <AcumuladoKpis a={acumulado} />
      </Seccion>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Seccion titulo={`Venta neta mensual ${periodo.anio}`} detalle={`L millones · línea punteada: ${periodo.anio - 1}`}
          accion={<Preguntar qs={qs} sobre="serie" />}>
          <SerieChart datos={puntos} anio={periodo.anio} mesSeleccionado={periodo.mes} />
        </Seccion>
        {!sinBase && (
          <Seccion titulo={`Variación por canal vs. ${contra}`} detalle={`Total: ${lempirasCompacto(totalCanal)}`}
            accion={<Preguntar qs={qs} sobre="canal" />}>
            <CanalChart filas={canales} />
          </Seccion>
        )}
      </div>

      {!sinBase && (
        <Seccion titulo="Rutas que más contribuyen a la variación" detalle="Cada ruta completa, con todas sus ventas en cualquier canal · las 10 que más cambiaron"
          accion={<div className="flex flex-wrap justify-end gap-x-4 gap-y-1"><Preguntar qs={qs} sobre="rutas" /><a href={`/api/exportar/rutas?${qs}`} className="shrink-0 text-xs text-neutral-600 underline">Exportar ruta × canal</a></div>}>
          <Table className="tabular-nums">
            <TableHeader>
              <TableRow>
                <TableHead>Ruta</TableHead>
                <TableHead className="text-right">{capital(periodoCorto(periodo))}</TableHead>
                <TableHead className="text-right">{capital(periodoCorto(cmp))}</TableHead>
                <TableHead className="text-right">Variación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {principales.length === 0 && (
                <TableRow><TableCell colSpan={4} className="py-6 text-center text-neutral-400">Sin ventas en {periodoLargo(periodo)} ni en {contra} con estos filtros.</TableCell></TableRow>
              )}
              {principales.map((r) => (
                <TableRow key={r.valor}>
                  <TableCell className="max-w-80 truncate" title={r.valor}>{r.valor}</TableCell>
                  <TableCell className="text-right">{lempirasCompacto(r.actual)}</TableCell>
                  <TableCell className="text-right">{lempirasCompacto(r.anterior)}</TableCell>
                  <TableCell className={`text-right ${r.variacion < 0 ? "text-red-700" : "text-emerald-700"}`}>{lempirasCompacto(r.variacion)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Seccion>
      )}

      {!sinBase && (
        <Seccion titulo={`Precio, volumen y mezcla vs. ${contra}`}
          detalle={`${lempirasCompacto(puente.venta_neta_cmp)} → ${lempirasCompacto(puente.venta_neta)} · cada renglón explica una parte de la variación`}
          accion={<Preguntar qs={qs} sobre="precio" />}>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <PuenteChart pasos={pasosPuente(puente, periodo, cmp)} total={puente.variacion} />
            <PuenteProductos p={puente} periodo={periodo} comparado={cmp} />
          </div>
        </Seccion>
      )}

      <Seccion titulo="Rutas fuera de lo normal"
        detalle={`Cambio de ${periodoLargo(periodo)} contra ${periodoLargo(anterior)}, comparado con lo que cada ruta suele moverse en los 12 meses anteriores`}
        accion={<Preguntar qs={qs} sobre="atipicas" />}>
        <RutasAtipicasTabla r={atipicas} periodo={periodo} anterior={anterior} />
        {atipicas.rutas_pequenas + atipicas.rutas_sin_historia > 0 && (
          <p className="mt-2 text-xs text-neutral-500 tabular-nums">
            Se evaluaron {atipicas.rutas_evaluadas} rutas. Quedan fuera {atipicas.rutas_pequenas} rutas chicas (promedio menor a {lempirasCompacto(atipicas.umbral_promedio)} al mes)
            y {atipicas.rutas_sin_historia} sin historia suficiente o sin venta el mes anterior.
          </p>
        )}
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

function subtitulo(periodo: { anio: number; mes: number }, cmp: { anio: number; mes: number }, f: FiltrosT, productos: VersionVigente["metadatos"]["producto"], conAlcance = false) {
  const partes = [`${capital(periodoLargo(periodo))} vs. ${periodoLargo(cmp)}`, "Honduras", f.canal ?? (conAlcance ? "los canales de tu acceso" : "todos los canales")];
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
        Fuente: cubo de ventas BIA · {version.archivo} · versión v{version.version} publicada {fechaLocal(version.publicado_en)} · cobertura {kpi.rutas_con_venta}/{kpi.rutas_total} rutas con venta en el periodo
      </p>
      {!version.conciliada_bi && <p className="text-amber-700">Cifras verificadas contra el Excel exportado, todavía no conciliadas con el reporte de BI.</p>}
      {avisos.map((a, i) => <p key={`${i}-${a}`} className="text-amber-700">{a}</p>)}
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
