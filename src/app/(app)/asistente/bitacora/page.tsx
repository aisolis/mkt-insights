import Link from "next/link";
import { requerirAdmin } from "@/lib/auth/acceso";
import { DIAS, ESTADOS, FiltroBitacora, leerBitacora, personasConPreguntas, type Estado } from "@/lib/asistente/bitacora-servidor";
import { ESTADO_TXT, fechaHora, segundos } from "./textos";

const ETIQUETA_ESTADO: Record<Estado, string> = {
  ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
  fuera_de_alcance: "bg-amber-50 text-amber-800 border-amber-200",
  sin_datos: "bg-neutral-100 text-neutral-700 border-neutral-200",
  error: "bg-red-50 text-red-800 border-red-200",
};

export default async function Bitacora(props: PageProps<"/asistente/bitacora">) {
  await requerirAdmin();
  const sp = await props.searchParams;
  const f = FiltroBitacora.parse({ estado: sp.estado, dias: sp.dias, usuario: sp.usuario });
  const [{ filas, resumen, truncada }, personas] = await Promise.all([leerBitacora(f), personasConPreguntas()]);

  const enlace = (cambio: Partial<Record<"estado" | "dias" | "usuario", string | undefined>>) => {
    const p = new URLSearchParams();
    const v = { estado: f.estado, dias: String(f.dias), usuario: f.usuario, ...cambio };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    return `/asistente/bitacora?${p}`;
  };
  const pct = (n: number) => (resumen.preguntas ? `${Math.round((n / resumen.preguntas) * 100)}%` : "—");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Bitácora del asistente</h1>
        <p className="text-sm text-neutral-500">
          Cada pregunta con su respuesta, las reglas activas en ese momento y el tiempo que tardó. Sirve para ver qué pregunta el
          equipo, qué se bloquea y dónde conviene ajustar reglas o el banco de preguntas. No incluye datos de clientes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <Filtro titulo="Periodo">
          {DIAS.map((d) => <Pastilla key={d} activa={f.dias === d} href={enlace({ dias: String(d) })}>Últimos {d} días</Pastilla>)}
        </Filtro>
        <Filtro titulo="Resultado">
          <Pastilla activa={!f.estado} href={enlace({ estado: undefined })}>Todos</Pastilla>
          {ESTADOS.map((e) => <Pastilla key={e} activa={f.estado === e} href={enlace({ estado: e })}>{ESTADO_TXT[e]}</Pastilla>)}
        </Filtro>
        <form className="flex items-center gap-2" action="/asistente/bitacora">
          <input type="hidden" name="dias" value={f.dias} />
          {f.estado && <input type="hidden" name="estado" value={f.estado} />}
          <label htmlFor="usuario" className="text-xs text-neutral-500">Persona</label>
          <select id="usuario" name="usuario" defaultValue={f.usuario ?? ""} className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-sm">
            <option value="">Todas</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <button type="submit" className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-xs font-medium hover:bg-neutral-100">Filtrar</button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Dato titulo="Preguntas" valor={String(resumen.preguntas)} nota={`${resumen.personas} ${resumen.personas === 1 ? "persona" : "personas"}`} />
        <Dato titulo="Fuera de alcance" valor={pct(resumen.fueraDeAlcance)} nota={`${resumen.fueraDeAlcance} bloqueadas por reglas fijas o del admin`} />
        <Dato titulo="Redacción automática" valor={resumen.conModelo ? `${Math.round((resumen.respaldo / resumen.conModelo) * 100)}%` : "—"}
          nota={`${resumen.respaldo} de ${resumen.conModelo} con IA: el texto traía cifras no verificadas o la IA falló`} />
        <Dato titulo="Errores" valor={pct(resumen.errores)} nota={`${resumen.errores} con error · ${resumen.sinDatos} sin datos`} />
        <Dato titulo="Tiempo típico" valor={resumen.medianaSeg === null ? "—" : `${segundos(resumen.medianaSeg)} s`} nota="mediana por pregunta" />
      </div>

      <section className="overflow-x-auto border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 font-medium">Persona</th>
              <th className="px-3 py-2 font-medium">Pregunta</th>
              <th className="px-3 py-2 font-medium">Resultado</th>
              <th className="px-3 py-2 font-medium">Redacción</th>
              <th className="px-3 py-2 text-right font-medium">Reglas</th>
              <th className="px-3 py-2 text-right font-medium">Tiempo</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-neutral-500">No hay preguntas con estos filtros.</td></tr>
            )}
            {filas.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
                <td className="whitespace-nowrap px-3 py-2 text-neutral-600 tabular-nums">{fechaHora(r.creado_en)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.usuario}</td>
                <td className="max-w-md px-3 py-2">
                  <Link href={`/asistente/bitacora/${r.id}`} className="line-clamp-2 underline-offset-4 hover:underline">{r.pregunta}</Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${ETIQUETA_ESTADO[r.estado]}`}>{ESTADO_TXT[r.estado]}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-600">
                  {r.modo === "modelo" ? (r.respaldo ? "Automática (respaldo)" : "IA verificada") : r.modo === "determinista" ? "Automática" : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{r.reglas || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-600">{r.duracion_ms === null ? "—" : `${segundos(r.duracion_ms / 1000)} s`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {truncada && <p className="text-xs text-neutral-500">Se muestran las 2,000 preguntas más recientes del periodo; el resumen se calcula sobre ellas.</p>}
    </div>
  );
}

function Filtro({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-neutral-500">{titulo}</span>
      {children}
    </div>
  );
}

function Pastilla({ activa, href, children }: { activa: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={activa ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${activa ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100"}`}>
      {children}
    </Link>
  );
}

function Dato({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
  return (
    <div className="border border-neutral-200 bg-white p-4">
      <div className="text-xs text-neutral-500">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="mt-1 text-xs text-neutral-500">{nota}</div>
    </div>
  );
}
