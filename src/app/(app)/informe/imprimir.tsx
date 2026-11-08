"use client";

/** Abre el diálogo de impresión del navegador; ahí se elige «Guardar como PDF». */
export function BotonImprimir({ deshabilitado }: { deshabilitado?: boolean }) {
  return (
    <button type="button" onClick={() => window.print()} disabled={deshabilitado}
      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:bg-neutral-300 print:hidden">
      Imprimir o guardar PDF
    </button>
  );
}
