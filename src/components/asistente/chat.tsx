"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CanalChart } from "@/components/dashboard/canal-chart";
import { SerieChart } from "@/components/dashboard/serie-chart";
import type { Respuesta, Turno, Visual } from "@/lib/asistente/tipos";
import type { Cita } from "@/lib/conocimiento/tipos";
import { fechaCorta, lempiras, mesNombre, capital } from "@/lib/format";
import {
  Destello, FlechaArriba, IconoAlerta, IconoCaja, IconoCodigo, IconoDocumento, IconoEscudo, IconoGrafico, IconoMapa,
  IconoMas, IconoPersonas, IconoTabla, IconoTendencia,
} from "./iconos";
import { aFilas, TablaDatos, type Datos } from "./tabla-datos";

type Intercambio = { pregunta: string; respuesta?: Respuesta; error?: string };

export type Sugerencia = { categoria: string; texto: string; icono: keyof typeof ICONOS };
const ICONOS = { tendencia: IconoTendencia, personas: IconoPersonas, caja: IconoCaja, mapa: IconoMapa } as const;
const TINTES = ["bg-indigo-50 text-indigo-600", "bg-rose-50 text-rose-600", "bg-sky-50 text-sky-600", "bg-amber-50 text-amber-600"];

type Props = {
  nombre: string;
  /** Query string del dashboard: el asistente hereda periodo, comparación y filtros. */
  contexto: string;
  /** Periodo y filtros en palabras, para el chip de contexto. */
  contextoTxt: string;
  version: number;
  inicial?: string;
  sugerencias: Sugerencia[];
  conModelo: boolean;
};

export function Chat({ nombre, contexto, contextoTxt, version, inicial, sugerencias, conModelo }: Props) {
  const [turnos, setTurnos] = useState<Intercambio[]>([]);
  const [enviando, setEnviando] = useState(false);
  const ultimo = useRef<HTMLDivElement>(null);
  const enviado = useRef(false);

  async function preguntar(pregunta: string) {
    pregunta = pregunta.trim();
    if (pregunta.length < 2 || enviando) return false;
    const historial: Turno[] = turnos.flatMap((t) => [
      { rol: "usuario" as const, texto: t.pregunta },
      ...(t.respuesta ? [{ rol: "asistente" as const, texto: t.respuesta.texto }] : []),
    ]);
    setTurnos((ts) => [...ts, { pregunta }]);
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
    return true;
  }

  // Llegada desde "Preguntar al asistente": se envía la pregunta sugerida una sola vez.
  useEffect(() => {
    if (inicial && !enviado.current) { enviado.current = true; void preguntar(inicial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicial]);
  // Al preguntar y al llegar la respuesta, la pregunta queda arriba: la respuesta se lee desde el principio.
  useEffect(() => { if (turnos.length) ultimo.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [turnos]);

  const chip = <ChipContexto texto={contextoTxt} contexto={contexto} />;
  const pie = (
    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-neutral-500">
      <IconoEscudo className="size-3.5 shrink-0" />
      {conModelo ? "Las cifras salen de consultas a la versión publicada y se verifican antes de mostrarse." : "Sin modelo de IA configurado: responde el análisis automático por reglas."}
      {" "}No se envían datos de clientes a la IA.
    </p>
  );

  if (turnos.length === 0) {
    return (
      <div className="relative -m-6 flex min-h-[calc(100vh-3.25rem)] flex-col items-center justify-center overflow-hidden px-6 py-12">
        <Resplandor />
        <div className="relative z-10 flex w-full flex-col items-center">
          <h1 className="text-center text-4xl font-semibold tracking-tight text-neutral-900">Hola, {nombre}</h1>
          <p className="mt-2 text-center text-lg text-neutral-600">¿Qué quieres saber de la venta?</p>
          <div className="mt-8 w-full max-w-3xl">
            <Caja grande onPreguntar={preguntar} enviando={enviando} chip={chip} />
          </div>
          <div className="mt-6 grid w-full max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sugerencias.map((s, i) => {
              const Icono = ICONOS[s.icono];
              return (
                <button key={s.texto} type="button" onClick={() => void preguntar(s.texto)}
                  className="group flex min-h-36 flex-col justify-between rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md">
                  <span>
                    <span className="block text-xs text-neutral-500">{s.categoria}</span>
                    <span className="mt-1 block text-sm font-medium leading-snug text-neutral-900">{s.texto}</span>
                  </span>
                  <span className={`mt-4 grid size-10 place-items-center rounded-lg ${TINTES[i % TINTES.length]}`}><Icono className="size-5" /></span>
                </button>
              );
            })}
          </div>
          <div className="mt-8">{pie}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6.5rem)] max-w-4xl flex-col">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex items-center gap-2">
          <Avatar />
          <div>
            <div className="text-sm font-semibold">Asistente de IA</div>
            <div className="text-xs text-neutral-500">Versión publicada v{version}</div>
          </div>
        </div>
        <button type="button" onClick={() => setTurnos([])} disabled={enviando}
          className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50">
          <IconoMas className="size-3.5" /> Nueva conversación
        </button>
      </div>

      <div className="flex-1 space-y-8 pb-6">
        {turnos.map((t, i) => (
          <div key={i} ref={i === turnos.length - 1 ? ultimo : undefined} className="scroll-mt-6 space-y-4">
            <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-neutral-200/70 px-4 py-2.5 text-sm text-neutral-900">{t.pregunta}</div>
            <div className="flex gap-3">
              <Avatar />
              <div className="min-w-0 flex-1">
                {t.respuesta ? <RespuestaVista r={t.respuesta} /> : t.error ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{t.error}</div>
                ) : <Pensando />}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 -mx-2 space-y-2 bg-gradient-to-t from-neutral-50 from-70% to-transparent px-2 pb-2 pt-6">
        <Caja onPreguntar={preguntar} enviando={enviando} chip={chip} />
        {pie}
      </div>
    </div>
  );
}

function Resplandor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute left-1/2 top-[38%] h-[420px] w-[900px] max-w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(129,140,248,0.34),transparent)] blur-2xl" />
      <div className="absolute left-[64%] top-[48%] h-[340px] w-[600px] max-w-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(244,114,182,0.26),transparent)] blur-2xl" />
    </div>
  );
}

function Avatar() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-rose-400 text-white shadow-sm">
      <Destello className="size-4" />
    </span>
  );
}

function ChipContexto({ texto, contexto }: { texto: string; contexto: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600">
      <span className="truncate" title={texto}>{texto}</span>
      <Link href={`/?${contexto}`} className="shrink-0 font-medium text-neutral-900 underline-offset-4 hover:underline">Cambiar</Link>
    </span>
  );
}

/** Caja de pregunta: crece con el texto; Enter envía y Shift+Enter baja de línea. */
function Caja({ grande, onPreguntar, enviando, chip }: { grande?: boolean; onPreguntar: (p: string) => Promise<boolean>; enviando: boolean; chip: React.ReactNode }) {
  const [texto, setTexto] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const ajustar = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  async function enviar() {
    const t = texto;
    if (t.trim().length < 2 || enviando) return;
    setTexto("");
    requestAnimationFrame(ajustar);
    await onPreguntar(t);
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void enviar(); }}
      className={`rounded-2xl border border-neutral-200 bg-white shadow-[0_10px_40px_-12px_rgba(15,23,42,0.18)] transition focus-within:border-neutral-300 ${grande ? "p-4" : "p-3"}`}>
      <textarea ref={ref} value={texto} maxLength={500} rows={grande ? 2 : 1} aria-label="Pregunta"
        onChange={(e) => { setTexto(e.target.value); ajustar(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
        placeholder={grande ? "Pregunta sobre venta, volumen, precio, clientes o facturas…" : "Haz otra pregunta…"}
        className={`w-full resize-none bg-transparent px-1 leading-relaxed outline-none placeholder:text-neutral-400 ${grande ? "text-base" : "text-sm"}`} />
      <div className="mt-2 flex items-center justify-between gap-3">
        {chip}
        <button type="submit" aria-label="Preguntar" disabled={enviando || texto.trim().length < 2}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-neutral-900 text-white transition hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-400">
          <FlechaArriba />
        </button>
      </div>
    </form>
  );
}

function Pensando() {
  return (
    <div className="space-y-3 pt-1" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-neutral-500">
        <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-indigo-400 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-indigo-500" /></span>
        Consultando la versión publicada y verificando cifras…
      </p>
      <div className="space-y-2">
        <div className="h-3 w-11/12 animate-pulse rounded bg-neutral-200" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-200" />
        <div className="mt-4 h-40 animate-pulse rounded-xl bg-neutral-100" />
      </div>
    </div>
  );
}

function RespuestaVista({ r }: { r: Respuesta }) {
  const [panel, setPanel] = useState<"consulta" | "evidencia" | null>(null);
  if (r.estado === "fuera_de_alcance") {
    return (
      <div className="space-y-3">
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
          <IconoAlerta className="mt-0.5 size-4 shrink-0" />
          <p>{r.texto}</p>
        </div>
        <ContextoDocumentos citas={r.contexto ?? []} />
      </div>
    );
  }
  const advertencias = r.evidencia.advertencias;
  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-relaxed text-neutral-900 tabular-nums">{r.texto}</p>

      {r.visuales.map((v, i) => <Resultado key={i} v={v} />)}

      {(r.hechos.length > 0 || r.hipotesis.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <Lista titulo="Hechos comprobados" items={r.hechos} punto="bg-emerald-500" />
          <Lista titulo="Hipótesis a validar" items={r.hipotesis} punto="bg-amber-500" vacio="Sin hipótesis: la pregunta se responde con los datos." />
        </div>
      )}

      <ContextoDocumentos citas={r.contexto ?? []} />

      {advertencias.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-800">
          {advertencias.map((a) => <li key={a} className="flex gap-1.5"><IconoAlerta className="mt-px size-3.5 shrink-0" />{a}</li>)}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3">
        {r.consultas.length > 0 && (
          <Pastilla activa={panel === "consulta"} onClick={() => setPanel(panel === "consulta" ? null : "consulta")}>
            <IconoCodigo className="size-3.5" /> Ver consulta y datos
          </Pastilla>
        )}
        <Pastilla activa={panel === "evidencia"} onClick={() => setPanel(panel === "evidencia" ? null : "evidencia")}>
          <IconoEscudo className="size-3.5" /> Evidencia
        </Pastilla>
        <span className="ml-auto text-xs text-neutral-500">
          v{r.evidencia.version} · corte {r.evidencia.fecha_corte} · {r.modo === "modelo" ? "redactó la IA, cifras verificadas" : "análisis automático por reglas"}
        </span>
      </div>

      {panel === "consulta" && <Consultas r={r} />}
      {panel === "evidencia" && <Evidencia r={r} />}
    </div>
  );
}

function Pastilla({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activa}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${activa ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100"}`}>
      {children}
    </button>
  );
}

/** Un resultado: gráfico o tabla con los mismos datos, como en un explorador de datos. */
function Resultado({ v }: { v: Visual }) {
  const [vista, setVista] = useState<"grafico" | "tabla">(v.tipo === "tabla" ? "tabla" : "grafico");
  const datos = datosDeVisual(v);
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2.5">
        <span className="text-sm font-medium text-neutral-900">{v.titulo}</span>
        {v.tipo !== "tabla" && (
          <div className="flex rounded-lg bg-neutral-100 p-0.5 text-xs">
            {(["grafico", "tabla"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setVista(k)} aria-pressed={vista === k}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${vista === k ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>
                {k === "grafico" ? <IconoGrafico className="size-3.5" /> : <IconoTabla className="size-3.5" />}
                {k === "grafico" ? "Gráfico" : "Tabla"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-4">
        {vista === "tabla" ? <TablaDatos datos={datos} /> : v.tipo === "variacion" ? (
          <CanalChart filas={v.filas} anchoEtiqueta={180} />
        ) : v.tipo === "serie" ? (
          <SerieChart datos={v.puntos} anio={v.anio} mesSeleccionado={v.mesSeleccionado} />
        ) : null}
      </div>
    </div>
  );
}

const conSigno = (v: number) => (v > 0 ? `+${lempiras(v)}` : lempiras(v));
const varPct = (a: number | null, b: number | null) => {
  if (a === null || b === null || b === 0) return "—";
  const p = (a / b - 1) * 100;
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toLocaleString("es-HN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
};

function datosDeVisual(v: Visual): Datos {
  if (v.tipo === "tabla") return { columnas: v.columnas, filas: v.filas };
  if (v.tipo === "variacion") {
    return {
      columnas: ["Valor", "Actual", "Comparado", "Variación", "Var. %"],
      filas: v.filas.map((f) => [f.valor, lempiras(f.actual), lempiras(f.anterior), conSigno(f.variacion), varPct(f.actual, f.anterior)]),
    };
  }
  return {
    columnas: ["Mes", String(v.anio), String(v.anio - 1), "Var. %"],
    filas: v.puntos.map((p) => [
      `${capital(mesNombre(p.mes))}${p.parcial ? " (parcial)" : ""}`,
      p.actual === null ? null : lempiras(p.actual),
      p.anterior === null ? null : lempiras(p.anterior),
      varPct(p.actual, p.anterior),
    ]),
  };
}

function Lista({ titulo, items, punto, vacio }: { titulo: string; items: string[]; punto: string; vacio?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-700">
        <span className={`size-1.5 rounded-full ${punto}`} />{titulo}
      </div>
      {items.length ? (
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-neutral-700 tabular-nums">{items.map((h) => <li key={h}>{h}</li>)}</ul>
      ) : <p className="text-[13px] text-neutral-400">{vacio}</p>}
    </div>
  );
}

/** Contexto de documentos autorizados (G6): aparte de los hechos, con documento, fuente y página. */
function ContextoDocumentos({ citas }: { citas: Cita[] }) {
  if (!citas.length) return null;
  return (
    <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-xs">
      <div>
        <div className="flex items-center gap-1.5 font-semibold text-sky-900"><IconoDocumento className="size-3.5" /> Contexto de documentos autorizados</div>
        <p className="mt-0.5 text-sky-900/80">No son datos de venta: sirven para entender causas y contexto.</p>
      </div>
      <ol className="space-y-3">
        {citas.map((c) => (
          <li key={c.id} className="space-y-1">
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

const NOMBRE_HERRAMIENTA: Record<string, string> = {
  kpi_periodo: "Indicadores del periodo",
  variacion_por_dimension: "Variación por dimensión",
  top_rutas: "Rutas que explican la variación",
  serie_mensual: "Serie mensual",
  descomposicion: "Descomposición de la venta",
};

function Consultas({ r }: { r: Respuesta }) {
  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
      {r.consultas.map((c) => {
        const datos = aFilas(c.datos);
        return (
          <div key={c.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600">{c.id}</span>
              <span className="font-medium">{NOMBRE_HERRAMIENTA[c.herramienta] ?? c.herramienta}</span>
              <span className="text-xs text-neutral-500">{c.calculo}</span>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-100">{`${c.herramienta}(${JSON.stringify(c.argumentos, null, 2)})`}</pre>
            {datos ? <TablaDatos datos={datos} maxAlto="max-h-72" /> : (
              <pre className="max-h-56 overflow-auto rounded-lg bg-neutral-50 p-2 text-[11px]">{JSON.stringify(c.datos, null, 1)}</pre>
            )}
          </div>
        );
      })}
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
    <div className="rounded-xl border border-neutral-200 bg-white p-4 text-xs">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
        {filas.map(([k, v]) => <div key={k} className="contents"><dt className="text-neutral-500">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
      </dl>
    </div>
  );
}
