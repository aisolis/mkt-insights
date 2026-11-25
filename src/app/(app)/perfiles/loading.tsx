import { Bloque, Cargando, EsqueletoEncabezado, EsqueletoFilas } from "@/components/esqueleto";

/** Perfiles y accesos: invitar, personas y actividad. */
export default function CargandoPerfiles() {
  return (
    <Cargando etiqueta="Cargando perfiles y accesos…" className="space-y-6">
      <EsqueletoEncabezado />
      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <Bloque className="h-4 w-40" />
        <Bloque className="h-9 w-full max-w-xl" />
      </section>
      <section className="space-y-2">
        <Bloque className="h-4 w-28" />
        <div className="border border-neutral-200 bg-white p-4"><EsqueletoFilas filas={5} columnas={4} /></div>
      </section>
      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <Bloque className="h-4 w-72 max-w-full" />
        <EsqueletoFilas filas={6} columnas={3} />
      </section>
    </Cargando>
  );
}
