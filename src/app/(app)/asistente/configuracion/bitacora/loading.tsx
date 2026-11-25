import { Bloque, Cargando, EsqueletoEncabezado, EsqueletoFilas } from "@/components/esqueleto";

/** Bitácora (el título y las pestañas ya los pinta el layout): filtros, totales y la tabla de preguntas. */
export default function CargandoBitacora() {
  return (
    <Cargando etiqueta="Cargando la bitácora…" className="space-y-6">
      <EsqueletoEncabezado nivel="seccion" />
      <div className="flex flex-wrap items-center gap-3">
        <Bloque className="h-8 w-64 max-w-full" />
        <Bloque className="h-8 w-48" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="border border-neutral-200 bg-white p-4">
            <Bloque className="h-3 w-20" />
            <Bloque className="mt-2 h-6 w-16" />
          </div>
        ))}
      </div>
      <section className="border border-neutral-200 bg-white p-4"><EsqueletoFilas filas={8} columnas={5} /></section>
    </Cargando>
  );
}
