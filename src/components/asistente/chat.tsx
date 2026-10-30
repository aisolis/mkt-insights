"use client";
import { useEffect, useRef, useState } from "react";
import { CanalChart } from "@/components/dashboard/canal-chart";
import { SerieChart } from "@/components/dashboard/serie-chart";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Respuesta, Turno, Visual } from "@/lib/asistente/tipos";
import type { Cita } from "@/lib/conocimiento/tipos";
import { fechaCorta } from "@/lib/format";

type Intercambio = { pregunta: string; respuesta?: Respuesta; error?: string };

export function Chat({ contexto, inicial, sugerencias, conModelo }: { contexto: string; inicial?: string; sugerencias: string[]; conModelo: boolean }) {
  const [turnos, setTurnos] = useState<Intercambio[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const enviado = useRef(false);

  async function preguntar(pregunta: string) {
    pregunta = pregunta.trim();
    if (!pregunta || enviando) return;
    const historial: Turno[] = turnos.flatMap((t) => [
      { rol: "usuario" as const, texto: t.pregunta },
      ...(t.respuesta ? [{ rol: "asistente" as const, texto: t.respuesta.texto }] : []),
    ]);
    setTurnos((ts) => [...ts, { pregunta }]);
    setTexto("");
    setEnviando(true);
    try {
      const res = await fetch("/api/asistente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pregunta, contexto, historial: historial.slice(-12) }),
      });
      const json = await res.json();
      const r: Intercambio = res.ok ? { pregunta, respuesta: json as Respuesta } : { pregunta, error: json.error ?? `Error ${res.status}` };
      setTurnos((ts) => [...ts.slice(0, -1), r]);
    } catch {
      setTurnos((ts) => [...ts.slice(0, -1), { pregunta, error: "No se pudo contactar al servidor." }]);
    } finally {
      setEnviando(false);
    }
  }

  // Llegada desde "Preguntar al asistente": se envía la pregunta sugerida una sola vez.
  useEffect(() => {
    if (inicial && !enviado.current) { enviado.current = true; void preguntar(inicial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicial]);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turnos]);

  return (
    <div className="space-y-4">
      {turnos.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {sugerencias.map((s) => (
            <Button key={s} variant="outline" size="sm" onClick={() => preguntar(s)}>{s}</Button>
          ))}
        </div>
      )}

      {turnos.map((t, i) => (
        <div key={i} className="space-y-3">
          <div className="ml-auto w-fit max-w-[80%] rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white">{t.pregunta}</div>
          {t.respuesta ? <RespuestaVista r={t.respuesta} /> : t.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{t.error}</div>
          ) : (
            <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Consultando la versión publicada…</div>
          )}
        </div>
      ))}
      <div ref={fin} />

      <form className="sticky bottom-0 flex items-end gap-2 bg-neutral-50 py-2" onSubmit={(e) => { e.preventDefault(); void preguntar(texto); }}>
        <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} rows={2} aria-label="Pregunta"
          placeholder="Pregunta sobre venta neta, volumen, precio, clientes o facturas por canal, ruta, marca o producto…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void preguntar(texto); } }}
          className="bg-white text-sm md:text-sm" />
        <Button type="submit" disabled={enviando || texto.trim().length < 2}>Preguntar</Button>
      </form>
      <p className="text-xs text-neutral-400">
        {conModelo ? "Redacta un modelo de IA (OpenRouter) sobre consultas controladas; sus cifras se verifican contra las consultas." : "Sin modelo de IA configurado: responde el análisis automático por reglas."}
        {" "}No se envían datos de clientes al modelo.
      </p>
    </div>
  );
}

function RespuestaVista({ r }: { r: Respuesta }) {
  if (r.estado === "fuera_de_alcance") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{r.texto}</div>
        <ContextoDocumentos citas={r.contexto ?? []} />
      </div>
    );
  }
  return (
    <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-sm leading-relaxed tabular-nums">{r.texto}</p>

      {r.visuales.map((v, i) => <VisualVista key={i} v={v} />)}

      {(r.hechos.length > 0 || r.hipotesis.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Lista titulo="Hechos comprobados" items={r.hechos} tono="text-emerald-800" />
          <Lista titulo="Hipótesis a validar" items={r.hipotesis} tono="text-amber-800" vacio="Sin hipótesis: la pregunta se responde con los datos." />
        </div>
      )}

      <ContextoDocumentos citas={r.contexto ?? []} />

      <Evidencia r={r} />

      {r.consultas.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-600 underline">Ver consulta y datos</summary>
          <div className="mt-2 space-y-3">
            {r.consultas.map((c) => (
              <div key={c.id} className="space-y-1">
                <div className="font-medium">{c.id} · {c.calculo}</div>
                <pre className="overflow-x-auto bg-neutral-50 p-2 text-[11px]">{JSON.stringify(c.argumentos, null, 1)}</pre>
                <pre className="max-h-56 overflow-auto bg-neutral-50 p-2 text-[11px]">{JSON.stringify(c.datos, null, 1)}</pre>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function VisualVista({ v }: { v: Visual }) {
  return (
    <figure className="space-y-2">
      <figcaption className="text-xs font-medium text-neutral-600">{v.titulo}</figcaption>
      {v.tipo === "variacion" && <CanalChart filas={v.filas} anchoEtiqueta={180} />}
      {v.tipo === "serie" && <SerieChart datos={v.puntos} anio={v.anio} mesSeleccionado={v.mesSeleccionado} />}
      {v.tipo === "tabla" && (
        <Table className="tabular-nums">
          <TableHeader>
            <TableRow>{v.columnas.map((c, i) => <TableHead key={c} className={i > 0 && v.columnas.length - i <= 3 ? "text-right" : ""}>{c}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {v.filas.map((f, j) => (
              <TableRow key={j}>
                {f.map((celda, i) => (
                  <TableCell key={i} className={`${i > 0 && f.length - i <= 3 ? "text-right" : "max-w-72 truncate"} ${i === f.length - 1 ? (celda.startsWith("−") ? "text-red-700" : celda.startsWith("+") ? "text-emerald-700" : "") : ""}`} title={celda}>{celda}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </figure>
  );
}

function Lista({ titulo, items, tono, vacio }: { titulo: string; items: string[]; tono: string; vacio?: string }) {
  return (
    <div>
      <div className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tono}`}>{titulo}</div>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-neutral-700 tabular-nums">{items.map((h) => <li key={h}>{h}</li>)}</ul>
      ) : <p className="text-xs text-neutral-400">{vacio}</p>}
    </div>
  );
}

/** Contexto de documentos autorizados (G6): aparte de los hechos, con documento, fuente y página. */
function ContextoDocumentos({ citas }: { citas: Cita[] }) {
  if (!citas.length) return null;
  return (
    <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/60 p-3 text-xs">
      <div className="font-semibold uppercase tracking-wide text-sky-800">Contexto de documentos autorizados</div>
      <p className="text-sky-900">No son datos de venta: sirven para entender causas y contexto.</p>
      <ol className="space-y-2">
        {citas.map((c) => (
          <li key={c.id} className="space-y-0.5">
            <div className="font-medium text-neutral-900">
              [{c.id}] {c.titulo}
              <span className="font-normal text-neutral-600"> · {c.fuente}{c.fecha && ` · ${fechaCorta(c.fecha)}`} · pág. {c.pagina}</span>
            </div>
            <blockquote className="border-l-2 border-sky-300 pl-2 text-neutral-700">{c.extracto}</blockquote>
            <a href={`/api/conocimiento/${c.documentoId}#page=${c.pagina}`} target="_blank" rel="noopener" className="text-sky-800 underline-offset-4 hover:underline">
              Abrir PDF en la página {c.pagina}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Evidencia({ r }: { r: Respuesta }) {
  const e = r.evidencia;
  const filas: [string, string][] = [
    ["Fuente", e.fuente],
    ["Versión", `v${e.version} · corte ${e.fecha_corte} · ${e.conciliada_bi ? "conciliada con BI" : "sin conciliar con BI"}`],
    ["Periodo", e.periodo],
    ["Filtros", e.filtros],
    ...(e.cobertura ? [["Cobertura", e.cobertura] as [string, string]] : []),
    ["Cálculo", e.calculo.join(", ") || "—"],
    ["Redacción", r.modo === "modelo" ? "modelo de IA, cifras verificadas" : "análisis automático por reglas"],
  ];
  return (
    <div className="rounded-md bg-neutral-50 p-3 text-xs">
      <div className="mb-2 font-semibold uppercase tracking-wide text-neutral-500">Evidencia</div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
        {filas.map(([k, v]) => <div key={k} className="contents"><dt className="text-neutral-500">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
        {e.advertencias.length > 0 && (
          <div className="contents">
            <dt className="text-neutral-500">Advertencia</dt>
            <dd className="space-y-0.5 text-amber-700">{e.advertencias.map((a) => <p key={a}>{a}</p>)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
