import { Bloque, Cargando, EsqueletoEncabezado, EsqueletoFilas } from "@/components/esqueleto";

/** Homologación de canales: aviso, canales pendientes y el formulario de equivalencia. */
export default function CargandoHomologacion() {
  return (
    <Cargando etiqueta="Cargando homologación de canales…" className="space-y-6">
      <div className="space-y-2">
        <Bloque className="h-3 w-36" />
        <EsqueletoEncabezado />
      </div>
      <Bloque className="h-24 w-full" />
      <section className="space-y-2">
        <Bloque className="h-4 w-56" />
        <div className="border border-neutral-200 bg-white p-4"><EsqueletoFilas filas={4} columnas={6} /></div>
      </section>
      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <Bloque className="h-4 w-44" />
        <Bloque className="h-9 w-full max-w-md" />
      </section>
    </Cargando>
  );
}
