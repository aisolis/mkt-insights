import { Bloque, Cargando, EsqueletoEncabezado, EsqueletoFilas } from "@/components/esqueleto";

/** Cargas y versiones: carga del mes y tabla de versiones publicadas. */
export default function CargandoCargas() {
  return (
    <Cargando etiqueta="Cargando cargas y versiones…" className="space-y-6">
      <EsqueletoEncabezado />
      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <Bloque className="h-4 w-32" />
        <Bloque className="h-4 w-full max-w-prose" />
        <Bloque className="h-4 w-2/3 max-w-prose" />
        <Bloque className="h-9 w-64 max-w-full" />
      </section>
      <section className="space-y-2">
        <Bloque className="h-4 w-40" />
        <div className="border border-neutral-200 bg-white p-4"><EsqueletoFilas filas={6} columnas={5} /></div>
      </section>
    </Cargando>
  );
}
