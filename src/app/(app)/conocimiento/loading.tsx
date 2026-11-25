import { Bloque, Cargando, EsqueletoEncabezado } from "@/components/esqueleto";

/** Conocimiento: la lista de documentos disponibles. */
export default function CargandoConocimiento() {
  return (
    <Cargando etiqueta="Cargando documentos…" className="space-y-6">
      <EsqueletoEncabezado />
      <section className="space-y-2">
        <Bloque className="h-4 w-44" />
        <div className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-start justify-between gap-3 p-3">
              <div className="flex-1 space-y-1.5">
                <Bloque className="h-4 w-56 max-w-full" />
                <Bloque className="h-3 w-72 max-w-full" />
              </div>
              <Bloque className="h-4 w-16" />
            </div>
          ))}
        </div>
      </section>
    </Cargando>
  );
}
