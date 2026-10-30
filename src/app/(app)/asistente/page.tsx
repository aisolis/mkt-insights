import Link from "next/link";
import { Chat } from "@/components/asistente/chat";
import { leerParams, periodoComparado, queryString } from "@/lib/dashboard/params";
import { describirFiltros, rango } from "@/lib/asistente/texto";
import { capital } from "@/lib/format";
import { configModelo } from "@/lib/asistente/modelo";
import { versionVigente } from "@/lib/semantic/queries";
import { requerirAcceso } from "@/lib/auth/acceso";

/** Pregunta sugerida según desde qué bloque del dashboard se llegó (?sobre=serie|canal|rutas). */
const SOBRE: Record<string, (anio: number) => string> = {
  serie: (anio) => `¿Cómo viene la venta neta mes a mes en ${anio}?`,
  canal: () => "¿Dónde se concentra la variación por canal?",
  rutas: () => "¿Qué rutas explican la variación?",
};

export default async function Asistente(props: PageProps<"/asistente">) {
  await requerirAcceso(); // el layout no se vuelve a ejecutar en cada navegación
  const version = await versionVigente();
  if (!version) {
    return <p className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">Todavía no hay una versión publicada.</p>;
  }
  const sp = await props.searchParams;
  const estado = leerParams(sp, version.metadatos.periodos);
  const cmp = periodoComparado(estado.periodo, estado.comparar);
  const qs = queryString(estado);
  const sobre = typeof sp.sobre === "string" ? SOBRE[sp.sobre]?.(estado.periodo.anio) : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Asistente de IA</h1>
        <p className="text-sm text-neutral-500">
          Responde sobre la versión publicada v{version.version}. Los cálculos salen de consultas controladas: la IA interpreta, no inventa datos.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-xs text-neutral-600">
        <span>
          <span className="text-neutral-400">Contexto del dashboard:</span> {capital(rango(estado.periodo, cmp))} · {describirFiltros(estado.filtros, version.metadatos)}
        </span>
        <Link href={`/?${qs}`} className="underline">Volver al dashboard</Link>
      </div>
      <Chat contexto={qs} inicial={sobre} conModelo={configModelo() !== null} sugerencias={[
        "¿Dónde se concentra la caída?",
        "¿Bajó el número de facturas o el ticket?",
        "¿Qué productos cayeron más en Mayoreo?",
        "Variación por marca vs. el año anterior",
      ]} />
    </div>
  );
}
