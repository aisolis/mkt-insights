"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RespuestaVista } from "@/components/asistente/chat";
import type { ItemInforme } from "@/lib/asistente/conversaciones";
import type { Respuesta } from "@/lib/asistente/tipos";
import { editarItemAccion, ordenarInformeAccion, quitarDelInformeAccion } from "./acciones";

const MAX_TITULO = 160;
const MAX_NOTA = 2000;

const FECHA = new Intl.DateTimeFormat("es-HN", { timeZone: "America/Tegucigalpa", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const fecha = (iso: string) => FECHA.format(new Date(iso));

/**
 * Lista del informe: ordenar, quitar, título y nota. Lo que no es contenido se oculta al imprimir. La página la
 * monta con una key de lo guardado: cuando el servidor vuelve a pintar, arranca de nuevo con eso.
 */
export function Informe({ items: inicial }: { items: ItemInforme[] }) {
  const [items, setItems] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const router = useRouter();

  function mover(i: number, paso: -1 | 1) {
    const j = i + paso;
    if (j < 0 || j >= items.length) return;
    const nuevo = [...items];
    [nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]];
    setItems(nuevo);
    setError(null);
    iniciar(async () => {
      const r = await ordenarInformeAccion(nuevo.map((x) => x.turnoId));
      if (r.error) { setError(r.error); router.refresh(); }
    });
  }

  function quitar(turnoId: number) {
    setItems((xs) => xs.filter((x) => x.turnoId !== turnoId));
    setError(null);
    iniciar(async () => {
      const r = await quitarDelInformeAccion(turnoId);
      if (r.error) { setError(r.error); router.refresh(); }
    });
  }

  async function editar(turnoId: number, titulo: string, nota: string) {
    const r = await editarItemAccion(turnoId, titulo, nota);
    if (r.error) return r.error;
    setItems((xs) => xs.map((x) => (x.turnoId === turnoId ? { ...x, titulo: titulo.trim() || null, nota: nota.trim() || null } : x)));
    return null;
  }

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
        Tu informe está vacío. En el <Link href="/asistente" className="font-medium text-neutral-900 underline-offset-4 hover:underline">asistente</Link>, usa
        «Agregar al informe» debajo de una respuesta para traerla aquí.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-sm text-red-700 print:hidden">{error}</p>}
      <ol className="space-y-8">
        {items.map((it, i) => (
          <li key={it.turnoId} className="space-y-3 border-t border-neutral-200 pt-6 first:border-t-0 first:pt-0 print:break-inside-auto">
            <Elemento item={it} numero={i + 1} total={items.length} ocupado={pendiente}
              onSubir={() => mover(i, -1)} onBajar={() => mover(i, 1)} onQuitar={() => quitar(it.turnoId)} onEditar={editar} />
          </li>
        ))}
      </ol>
    </div>
  );
}

type PropsElemento = {
  item: ItemInforme; numero: number; total: number; ocupado: boolean;
  onSubir: () => void; onBajar: () => void; onQuitar: () => void;
  onEditar: (turnoId: number, titulo: string, nota: string) => Promise<string | null>;
};

function Elemento({ item, numero, total, ocupado, onSubir, onBajar, onQuitar, onEditar }: PropsElemento) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(item.titulo ?? "");
  const [nota, setNota] = useState(item.nota ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boton = "rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40";

  async function guardar() {
    setGuardando(true);
    const e = await onEditar(item.turnoId, titulo, nota);
    setGuardando(false);
    setError(e);
    if (!e) setEditando(false);
  }

  return (
    <article className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 break-inside-avoid">
        <div className="min-w-0 space-y-1">
          <div className="text-xs text-neutral-500">{numero}. · {fecha(item.respondidaEn)}</div>
          <h2 className="text-lg font-semibold leading-snug">{item.titulo ?? item.pregunta}</h2>
          {item.titulo && <p className="text-sm text-neutral-600">Pregunta: {item.pregunta}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 print:hidden">
          <button type="button" onClick={onSubir} disabled={ocupado || numero === 1} className={boton} aria-label="Subir">↑</button>
          <button type="button" onClick={onBajar} disabled={ocupado || numero === total} className={boton} aria-label="Bajar">↓</button>
          <button type="button" onClick={() => setEditando((x) => !x)} className={boton} aria-expanded={editando}>Título y nota</button>
          {item.conversacionId && <Link href={`/asistente?c=${item.conversacionId}`} className={boton}>Ver conversación</Link>}
          <button type="button" onClick={onQuitar} disabled={ocupado} className={`${boton} text-red-700`}>Quitar</button>
        </div>
      </div>

      {editando && (
        <form onSubmit={(e) => { e.preventDefault(); void guardar(); }} className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 print:hidden">
          <label className="block text-xs text-neutral-600">
            Título (vacío = la pregunta)
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={MAX_TITULO}
              className="mt-1 h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm" />
          </label>
          <label className="block text-xs text-neutral-600">
            Nota (aparece al imprimir, antes de la respuesta)
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={MAX_NOTA} rows={3}
              className="mt-1 w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm" />
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={guardando} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" onClick={() => { setEditando(false); setTitulo(item.titulo ?? ""); setNota(item.nota ?? ""); setError(null); }}
              className="text-xs text-neutral-600 underline-offset-4 hover:underline">Cancelar</button>
            {error && <span className="text-xs text-red-700">{error}</span>}
          </div>
        </form>
      )}

      {item.nota && <p className="whitespace-pre-wrap border-l-2 border-neutral-300 pl-3 text-sm text-neutral-700">{item.nota}</p>}

      <RespuestaVista r={item.respuesta} />
      <Evidencia r={item.respuesta} />
    </article>
  );
}

/** Evidencia siempre visible (también impresa): con qué datos y bajo qué condiciones se respondió. */
function Evidencia({ r }: { r: Respuesta }) {
  const e = r.evidencia;
  if (!e) return null;
  const filas: [string, string][] = [
    ["Fuente", e.fuente],
    ["Versión", `v${e.version} · corte ${e.fecha_corte} · ${e.conciliada_bi ? "conciliada con BI" : "sin conciliar con BI"}`],
    ["Periodo", e.periodo],
    ["Filtros", e.filtros],
    ...(e.cobertura ? [["Cobertura", e.cobertura] as [string, string]] : []),
    ["Redacción", r.modo === "modelo" ? "modelo de IA, cifras verificadas" : "análisis automático por reglas"],
  ];
  return (
    <div className="break-inside-avoid rounded-lg border border-neutral-200 bg-white p-3 text-xs">
      <div className="mb-1.5 font-semibold text-neutral-700">Evidencia</div>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">
        {filas.map(([k, v]) => <div key={k} className="contents"><dt className="text-neutral-500">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
      </dl>
      {/* En las respondidas, las advertencias ya van junto a la respuesta. */}
      {r.estado === "fuera_de_alcance" && e.advertencias.length > 0 && (
        <ul className="mt-1.5 list-disc pl-4 text-amber-800">{e.advertencias.map((a, i) => <li key={`${i}-${a}`}>{a}</li>)}</ul>
      )}
    </div>
  );
}
