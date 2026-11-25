import { Bloque, Cargando, EsqueletoFilas } from "@/components/esqueleto";

/** Detalle de una pregunta de la bitácora. */
export default function CargandoDetalleBitacora() {
  return (
    <Cargando etiqueta="Cargando el detalle…" className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Bloque className="h-3 w-20" />
        <Bloque className="h-6 w-full max-w-xl" />
      </div>
      <section className="border border-neutral-200 bg-white p-4"><EsqueletoFilas filas={8} columnas={2} /></section>
      <section className="space-y-2">
        <Bloque className="h-4 w-64 max-w-full" />
        <Bloque className="h-16 w-full" />
      </section>
    </Cargando>
  );
}
