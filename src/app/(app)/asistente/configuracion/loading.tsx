import { Bloque, Cargando, EsqueletoFilas } from "@/components/esqueleto";

/** Modelo del asistente (el título y las pestañas ya los pinta el layout): tarjetas y formularios. */
export default function CargandoConfiguracion() {
  return (
    <Cargando etiqueta="Cargando la configuración del asistente…" className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="border border-neutral-200 bg-white p-4">
            <Bloque className="h-3 w-20" />
            <Bloque className="mt-2 h-6 w-32" />
            <Bloque className="mt-2 h-3 w-40" />
          </div>
        ))}
      </div>
      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <Bloque className="h-4 w-40" />
        <Bloque className="h-9 w-full max-w-md" />
      </section>
      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <Bloque className="h-4 w-36" />
        <EsqueletoFilas filas={3} columnas={2} />
      </section>
    </Cargando>
  );
}
