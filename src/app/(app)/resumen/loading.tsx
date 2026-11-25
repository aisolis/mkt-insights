import { Bloque, Cargando, EsqueletoFilas } from "@/components/esqueleto";

/** Resumen del mes: selector de versión, titular y tabla de indicadores. */
export default function CargandoResumen() {
  return (
    <Cargando etiqueta="Cargando el resumen del mes…" className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end gap-3 border border-neutral-200 bg-white p-3">
        <Bloque className="h-9 w-32" />
        <Bloque className="h-9 w-40" />
        <Bloque className="h-9 w-14" />
      </div>
      <div className="space-y-2">
        <Bloque className="h-3 w-48" />
        <Bloque className="h-8 w-64" />
        <Bloque className="h-4 w-80 max-w-full" />
        <Bloque className="mt-2 h-5 w-full" />
      </div>
      <section className="border border-neutral-200 bg-white p-3">
        <EsqueletoFilas filas={6} />
      </section>
      <section className="border border-neutral-200 bg-white p-3">
        <EsqueletoFilas filas={5} />
      </section>
    </Cargando>
  );
}
