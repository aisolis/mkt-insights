"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guardarColumnaAccion, guardarFormatoAccion, type Estado } from "./acciones";

function Aviso({ estado }: { estado: Estado }) {
  if (!estado?.error && !estado?.ok) return null;
  return <p role={estado.error ? "alert" : "status"} className={`text-sm ${estado.error ? "text-red-700" : "text-emerald-700"}`}>{estado.error ?? estado.ok}</p>;
}

/** Nombres aceptados de un campo (uno por línea) y, si el campo puede faltar, si es obligatorio. */
export function FormColumna({ campo, encabezados, obligatoria, puedeFaltar }: { campo: string; encabezados: string[]; obligatoria: boolean; puedeFaltar: boolean }) {
  const [estado, accion, enviando] = useActionState(guardarColumnaAccion, null);
  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="campo" value={campo} />
      <label className="block space-y-1 text-sm">
        <span className="text-neutral-700">Nombres de columna aceptados, uno por línea</span>
        <textarea name="encabezados" defaultValue={encabezados.join("\n")} required rows={Math.min(8, Math.max(3, encabezados.length + 1))}
          className="block w-full min-w-0 border border-input bg-background px-2 py-1.5 font-mono text-sm" />
        <span className="block text-xs text-neutral-500">No importan mayúsculas, tildes, espacios ni signos: «Café/Rep» también acepta «CAFE REP».</span>
      </label>
      {puedeFaltar ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="obligatoria" defaultChecked={obligatoria} className="mt-1" />
          <span>Obligatoria: si el archivo no la trae, la hoja no se carga. Sin marcar, se carga vacía y la carga lo avisa antes de publicar.</span>
        </label>
      ) : (
        <input type="hidden" name="obligatoria" value="on" />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</Button>
        <Aviso estado={estado} />
      </div>
    </form>
  );
}

export function FormFormato({ fila, hojas }: { fila: number; hojas: string[] }) {
  const [estado, accion, enviando] = useActionState(guardarFormatoAccion, null);
  return (
    <form action={accion} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <label className="block space-y-1 text-sm">
          <span className="text-neutral-700">Fila de los encabezados</span>
          <Input name="fila" type="number" min={1} max={50} defaultValue={fila} required className="h-9 text-sm md:text-sm" />
          <span className="block text-xs text-neutral-500">Las filas de arriba (títulos, filtros) se saltan.</span>
        </label>
        <label className="block min-w-0 space-y-1 text-sm">
          <span className="text-neutral-700">Hojas que se saltan, una por línea</span>
          <textarea name="hojas" defaultValue={hojas.join("\n")} rows={3} className="block w-full min-w-0 border border-input bg-background px-2 py-1.5 font-mono text-sm" />
          <span className="block text-xs text-neutral-500">Para hojas de apoyo que no son ventas. Las demás hojas sin las columnas también se saltan, pero la carga lo avisa.</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</Button>
        <Aviso estado={estado} />
      </div>
    </form>
  );
}
