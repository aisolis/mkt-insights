"use client";
import { useState } from "react";
import type { ConversacionResumen } from "@/lib/asistente/conversaciones";
import { fechaLocal } from "@/lib/format";
import { IconoMas } from "./iconos";

type P = { className?: string };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", viewBox: "0 0 24 24", "aria-hidden": true } as const;
const IconoLapiz = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
);
const IconoArchivar = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" /></svg>
);
export const IconoConversaciones = ({ className = "size-4" }: P) => (
  <svg {...base} className={className}><path d="M4 6h16M4 12h16M4 18h10" /></svg>
);

const DIA_HN = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" });

/** "hace 5 min", "hace 3 h", "ayer", "hace 4 días" o la fecha corta, con los días en hora de Honduras. */
export function fechaRelativa(instante: string, ahora = Date.now()): string {
  const t = new Date(instante).getTime();
  const minutos = Math.floor((ahora - t) / 60_000);
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `hace ${minutos} min`;
  const hoy = DIA_HN.format(new Date(ahora)), dia = DIA_HN.format(new Date(t));
  if (dia === hoy) return `hace ${Math.floor(minutos / 60)} h`;
  const dias = Math.round((Date.parse(hoy) - Date.parse(dia)) / 86_400_000);
  if (dias === 1) return "ayer";
  if (dias < 7) return `hace ${dias} días`;
  return fechaLocal(instante);
}

type Props = {
  conversaciones: ConversacionResumen[];
  activa: string | null;
  /** Mientras se responde una pregunta no se cambia de conversación. */
  ocupado: boolean;
  onNueva: () => void;
  onAbrir: (id: string) => void;
  onRenombrar: (id: string, titulo: string) => Promise<boolean>;
  onArchivar: (id: string) => Promise<boolean>;
};

/** Panel de conversaciones del asistente: nueva, abrir, renombrar y archivar. */
export function PanelConversaciones({ conversaciones, activa, ocupado, onNueva, onAbrir, onRenombrar, onArchivar }: Props) {
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  async function guardar(c: ConversacionResumen, titulo: string) {
    setEditando(null);
    const t = titulo.trim();
    if (t && t !== c.titulo) await onRenombrar(c.id, t);
  }

  return (
    <nav aria-label="Conversaciones" className="flex h-full w-[260px] flex-col border-r border-neutral-200 bg-white">
      <div className="p-3">
        <button type="button" onClick={onNueva} disabled={ocupado}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50">
          <IconoMas className="size-4" /> Nueva conversación
        </button>
      </div>
      <div className="px-4 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Conversaciones</div>
      {conversaciones.length === 0 ? (
        <p className="px-4 py-2 text-xs leading-relaxed text-neutral-500">Todavía no hay conversaciones. Cada chat queda guardado aquí para retomarlo.</p>
      ) : (
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {conversaciones.map((c) => {
            const esActiva = c.id === activa;
            if (editando === c.id) {
              return (
                <li key={c.id} className="rounded-lg bg-neutral-100 p-1.5">
                  <input autoFocus defaultValue={c.titulo} maxLength={120} aria-label="Nuevo título"
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => void guardar(c, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                      if (e.key === "Escape") { e.preventDefault(); setEditando(null); }
                    }}
                    className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500" />
                </li>
              );
            }
            return (
              <li key={c.id} className={`group relative rounded-lg transition ${esActiva ? "bg-neutral-100" : "hover:bg-neutral-50"}`}>
                <button type="button" onClick={() => onAbrir(c.id)} disabled={ocupado && !esActiva} aria-current={esActiva ? "page" : undefined}
                  className="block w-full min-w-0 rounded-lg px-2.5 py-2 pr-14 text-left disabled:cursor-not-allowed">
                  <span className={`block truncate text-sm ${esActiva ? "font-medium text-neutral-900" : "text-neutral-700"}`} title={c.titulo}>{c.titulo}</span>
                  {confirmando !== c.id && (
                    <span className="mt-0.5 block text-xs text-neutral-500" suppressHydrationWarning>
                      {fechaRelativa(c.actualizada_en)} · {c.preguntas} {c.preguntas === 1 ? "pregunta" : "preguntas"}
                    </span>
                  )}
                </button>
                {confirmando === c.id ? (
                  <div className="flex items-center gap-2 px-2.5 pb-2 text-xs">
                    <span className="text-neutral-600">¿Archivar?</span>
                    <button type="button" onClick={async () => { setConfirmando(null); await onArchivar(c.id); }}
                      className="rounded-md bg-neutral-900 px-2 py-0.5 font-medium text-white hover:bg-neutral-700">Archivar</button>
                    <button type="button" onClick={() => setConfirmando(null)} className="rounded-md px-2 py-0.5 text-neutral-600 hover:bg-neutral-200">Cancelar</button>
                  </div>
                ) : (
                  <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-100 transition focus-within:opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                    <button type="button" onClick={() => setEditando(c.id)} aria-label={`Renombrar «${c.titulo}»`} title="Renombrar"
                      className="grid size-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900">
                      <IconoLapiz className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setConfirmando(c.id)} disabled={ocupado && esActiva} aria-label={`Archivar «${c.titulo}»`} title="Archivar"
                      className="grid size-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-40">
                      <IconoArchivar className="size-3.5" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
