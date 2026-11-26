import { Bloque, Cargando, EsqueletoEncabezado } from "@/components/esqueleto";

/** Presupuestos de IA (el título y las pestañas ya los pinta el layout). */
export default function CargandoPresupuestos() {
  return (
    <Cargando etiqueta="Cargando presupuestos…" className="space-y-6">
      <EsqueletoEncabezado nivel="seccion" />
      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <Bloque className="h-4 w-56" />
        <Bloque className="h-9 w-64" />
      </section>
      <section className="space-y-2">
        <Bloque className="h-4 w-40" />
        <div className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
          {Array.from({ length: 6 }, (_, j) => <div key={j} className="p-3"><Bloque className="h-4 w-full max-w-2xl" /></div>)}
        </div>
      </section>
    </Cargando>
  );
}
