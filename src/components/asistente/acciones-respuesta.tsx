"use client";
import Link from "next/link";
import { useState } from "react";
import type { Valoracion } from "@/lib/asistente/conversaciones";
import { IconoCheck, IconoInforme, PulgarAbajo, PulgarArriba } from "./iconos";

const MAX_COMENTARIO = 1000;

type Props = {
  turnoId: number;
  valoracion: Valoracion | null;
  enInforme: boolean;
  /** Para que el chat recuerde el cambio si la respuesta se vuelve a pintar. */
  onCambio?: (c: { valoracion?: Valoracion | null; enInforme?: boolean }) => void;
};

/**
 * Debajo de cada respuesta (G9): 👍/👎 con comentario opcional y «Agregar al informe». El servidor solo acepta
 * turnos del propio usuario.
 */
export function AccionesRespuesta({ turnoId, valoracion: inicial, enInforme: fijada, onCambio }: Props) {
  const [valoracion, setValoracion] = useState(inicial);
  const [enInforme, setEnInforme] = useState(fijada);
  const [comentando, setComentando] = useState(false);
  const [texto, setTexto] = useState(inicial?.comentario ?? "");
  const [ocupado, setOcupado] = useState<"valorar" | "informe" | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  async function valorar(util: boolean | null, comentario?: string) {
    setOcupado("valorar");
    setAviso(null);
    try {
      const res = await fetch(`/api/asistente/turnos/${turnoId}/valoracion`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ util, comentario: comentario ?? null }),
      });
      const json = (await res.json().catch(() => ({}))) as { valoracion?: Valoracion | null; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      const v = json.valoracion ?? null;
      setValoracion(v);
      onCambio?.({ valoracion: v });
      return true;
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo guardar la valoración." });
      return false;
    } finally {
      setOcupado(null);
    }
  }

  async function pulgar(util: boolean) {
    // Volver a tocar el mismo pulgar quita la valoración.
    if (valoracion?.util === util) {
      if (await valorar(null)) { setComentando(false); setTexto(""); }
      return;
    }
    if (await valorar(util, texto.trim() || undefined)) setComentando(true);
  }

  async function enviarComentario() {
    if (!valoracion) return;
    if (await valorar(valoracion.util, texto.trim() || undefined)) {
      setComentando(false);
      setAviso({ tipo: "ok", texto: "Gracias, el comentario quedó guardado." });
    }
  }

  async function alternarInforme() {
    setOcupado("informe");
    setAviso(null);
    try {
      const res = await fetch(`/api/asistente/turnos/${turnoId}/informe`, { method: enInforme ? "DELETE" : "POST" });
      const json = (await res.json().catch(() => ({}))) as { enInforme?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setEnInforme(!!json.enInforme);
      onCambio?.({ enInforme: !!json.enInforme });
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo actualizar el informe." });
    } finally {
      setOcupado(null);
    }
  }

  const boton = (activo: boolean) =>
    `grid size-8 place-items-center rounded-full border transition disabled:opacity-50 ${activo ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100"}`;

  return (
    <div className="mt-3 space-y-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">¿Te sirvió?</span>
        <button type="button" onClick={() => void pulgar(true)} disabled={ocupado !== null} aria-pressed={valoracion?.util === true}
          aria-label="Me sirvió" title="Me sirvió" className={boton(valoracion?.util === true)}>
          <PulgarArriba className="size-4" />
        </button>
        <button type="button" onClick={() => void pulgar(false)} disabled={ocupado !== null} aria-pressed={valoracion?.util === false}
          aria-label="No me sirvió" title="No me sirvió" className={boton(valoracion?.util === false)}>
          <PulgarAbajo className="size-4" />
        </button>
        {valoracion && !comentando && (
          <button type="button" onClick={() => setComentando(true)} className="text-xs text-neutral-600 underline-offset-4 hover:underline">
            {valoracion.comentario ? "Editar comentario" : "Agregar comentario"}
          </button>
        )}

        <span className="ml-auto flex items-center gap-2">
          {enInforme && <Link href="/informe" className="text-xs text-neutral-600 underline-offset-4 hover:underline">Ver informe</Link>}
          <button type="button" onClick={() => void alternarInforme()} disabled={ocupado !== null} aria-pressed={enInforme}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${enInforme ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100"}`}>
            {enInforme ? <IconoCheck className="size-3.5" /> : <IconoInforme className="size-3.5" />}
            {ocupado === "informe" ? "Guardando…" : enInforme ? "En el informe · Quitar" : "Agregar al informe"}
          </button>
        </span>
      </div>

      {valoracion && comentando && (
        <form onSubmit={(e) => { e.preventDefault(); void enviarComentario(); }} className="space-y-2">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={MAX_COMENTARIO} rows={2}
            aria-label="Comentario sobre la respuesta"
            placeholder={valoracion.util ? "¿Algo que agregar? (opcional)" : "¿Qué faltó o qué estuvo mal? (opcional)"}
            className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400" />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={ocupado !== null}
              className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
              {ocupado === "valorar" ? "Guardando…" : "Guardar comentario"}
            </button>
            <button type="button" onClick={() => { setComentando(false); setTexto(valoracion.comentario ?? ""); }}
              className="text-xs text-neutral-600 underline-offset-4 hover:underline">Cerrar</button>
            <span className="ml-auto text-[11px] text-neutral-400 tabular-nums">{texto.length}/{MAX_COMENTARIO}</span>
          </div>
        </form>
      )}

      {aviso && <p role="status" className={`text-xs ${aviso.tipo === "error" ? "text-red-700" : "text-emerald-700"}`}>{aviso.texto}</p>}
    </div>
  );
}
