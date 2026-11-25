import { Bloque, Cargando, EsqueletoSeccion } from "@/components/esqueleto";

/** Informe: encabezado con acciones y las respuestas guardadas. */
export default function CargandoInforme() {
  return (
    <Cargando etiqueta="Cargando el informe…" className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-4">
        <div className="space-y-2">
          <Bloque className="h-7 w-32" />
          <Bloque className="h-4 w-72 max-w-full" />
        </div>
        <Bloque className="h-9 w-28" />
      </div>
      <EsqueletoSeccion filas={4} columnas={1} />
      <EsqueletoSeccion filas={4} columnas={1} />
    </Cargando>
  );
}
