import Link from "next/link";
import { notFound } from "next/navigation";
import { RespuestaVista } from "@/components/asistente/chat";
import { requerirAdmin } from "@/lib/auth/acceso";
import { detalleBitacora } from "@/lib/asistente/bitacora-servidor";
import { ESTADO_TXT, fechaHora, segundos } from "../textos";

const TIPO_TXT = { instruccion: "Instrucción", definicion: "Definición", bloqueo: "Bloqueo" } as const;

export default async function DetalleBitacora(props: PageProps<"/asistente/configuracion/bitacora/[id]">) {
  await requerirAdmin();
  const { id } = await props.params;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) notFound();
  const d = await detalleBitacora(n);
  if (!d) notFound();

  const datos: [string, React.ReactNode][] = [
    ["Fecha", fechaHora(d.creado_en)],
    ["Persona", d.usuario],
    ["Conversación", d.conversacion ?? "—"],
    ["Versión", d.version ? `v${d.version}` : "—"],
    ["Contexto", d.contexto || "periodo por defecto"],
    ["Resultado", ESTADO_TXT[d.estado]],
    ["Redacción", d.modo === "modelo" ? `IA (${d.modelo ?? "modelo"}), cifras verificadas` : d.modo === "determinista" ? "Automática por reglas" : "—"],
    ["Tiempo", d.duracion_ms === null ? "—" : `${segundos(d.duracion_ms / 1000)} s`],
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Link href="/asistente/configuracion/bitacora" className="text-xs text-neutral-500 underline-offset-4 hover:underline">← Bitácora</Link>
        <h2 className="text-lg font-semibold">{d.pregunta}</h2>
      </div>

      <section className="border border-neutral-200 bg-white p-4">
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[8rem_1fr]">
          {datos.map(([k, v]) => <div key={k} className="contents"><dt className="text-neutral-500">{k}</dt><dd className="break-words tabular-nums">{v}</dd></div>)}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Reglas del asistente activas al responder</h2>
        {d.reglas.length === 0 ? <p className="text-sm text-neutral-500">Ninguna: se respondió solo con las reglas fijas.</p> : (
          <ul className="space-y-1.5 border border-neutral-200 bg-white p-4 text-sm">
            {d.reglas.map((r) => (
              <li key={r.id}>
                <span className="font-medium">{r.tipo ? TIPO_TXT[r.tipo] : "Regla"}:</span> {r.texto ?? "(sin registro del texto)"}
                {!r.vigente && <span className="text-neutral-500"> · eliminada después</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.error && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Error técnico</h2>
          <pre className="overflow-x-auto whitespace-pre-wrap border border-red-200 bg-red-50 p-3 text-xs text-red-900">{d.error}</pre>
        </section>
      )}

      {d.respuesta && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Lo que vio la persona</h2>
          <div className="border border-neutral-200 bg-neutral-50 p-4">
            <RespuestaVista r={d.respuesta} />
          </div>
        </section>
      )}
    </div>
  );
}
