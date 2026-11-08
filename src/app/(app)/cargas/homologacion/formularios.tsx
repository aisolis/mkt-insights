"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { eliminarHomologacionAccion, guardarHomologacionAccion, type Estado } from "./acciones";

function Aviso({ estado }: { estado: Estado }) {
  if (!estado?.error && !estado?.ok) return null;
  return <p role={estado.error ? "alert" : "status"} className={`text-sm ${estado.error ? "text-red-700" : "text-emerald-700"}`}>{estado.error ?? estado.ok}</p>;
}

/**
 * Agregar o cambiar una equivalencia. `editando`: el canal de origen ya tiene equivalencia y no se cambia aquí.
 * El canal BIA se elige de los que ya existen; uno nuevo exige confirmarlo para no crear variantes de escritura.
 */
/** `origenFijo`: se llegó desde «Homologar» de un canal (incluso vacío): el origen no se escribe a mano. */
export function FormHomologacion({ origen, actual, editando, canales, origenFijo = false }: { origen: string; actual: string | null; editando: boolean; canales: string[]; origenFijo?: boolean }) {
  const [estado, accion, enviando] = useActionState(guardarHomologacionAccion, null);
  const [canal, setCanal] = useState(actual ?? "");
  return (
    <form action={accion} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="text-neutral-700">Canal de origen (como viene en la columna «Canal BIA» del Excel)</span>
          {editando || origenFijo ? (
            <>
              <input type="hidden" name="origen" value={origen} />
              <div className="flex h-9 items-center border border-neutral-200 bg-neutral-50 px-2 font-mono text-sm">{origen || "(vacío)"}</div>
            </>
          ) : (
            <Input name="origen" defaultValue={origen} required maxLength={100} placeholder="p. ej. MAYOREO NORTE" className="h-9 text-sm md:text-sm" />
          )}
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-neutral-700">Canal BIA con que se mostrará</span>
          <select name="canal" value={canal} onChange={(e) => setCanal(e.target.value)} required className="block h-9 w-full border border-input bg-background px-2 text-sm">
            <option value="" disabled>Elige un canal…</option>
            {canales.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__nuevo">Otro: un canal BIA nuevo…</option>
          </select>
        </label>
      </div>
      {canal === "__nuevo" && (
        <div className="space-y-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <Input name="canalNuevo" required maxLength={60} placeholder="Nombre del canal BIA nuevo" className="h-9 bg-white text-sm md:text-sm" />
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirmaNuevo" required className="mt-1" />
            <span>Es un canal BIA nuevo, acordado con BIA. Aparecerá como un canal más en el dashboard cuando se publique una carga que lo traiga.</span>
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={enviando}>{enviando ? "Guardando…" : editando ? "Guardar cambio" : "Agregar equivalencia"}</Button>
        <Aviso estado={estado} />
      </div>
    </form>
  );
}

export function QuitarHomologacion({ origen, canal }: { origen: string; canal: string }) {
  const [estado, accion, enviando] = useActionState(eliminarHomologacionAccion, null);
  return (
    <form action={accion} className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (!confirm(`¿Quitar la equivalencia «${origen || "(vacío)"}» → ${canal}? Las cargas sin publicar y las próximas mostrarán el nombre de origen. Lo publicado no cambia.`)) e.preventDefault();
      }}>
      <input type="hidden" name="origen" value={origen} />
      <Button type="submit" variant="outline" size="xs" disabled={enviando}>Quitar</Button>
      {estado?.error && <Aviso estado={estado} />}
    </form>
  );
}
