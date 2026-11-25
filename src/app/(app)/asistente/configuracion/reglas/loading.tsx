import { Bloque, Cargando, EsqueletoEncabezado } from "@/components/esqueleto";

/** Reglas del asistente (el título y las pestañas ya los pinta el layout). */
export default function CargandoReglas() {
  return (
    <Cargando etiqueta="Cargando reglas…" className="space-y-6">
      <EsqueletoEncabezado nivel="seccion" />
      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <Bloque className="h-4 w-36" />
        <Bloque className="h-20 w-full" />
      </section>
      {Array.from({ length: 2 }, (_, i) => (
        <section key={i} className="space-y-2">
          <Bloque className="h-4 w-32" />
          <div className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
            {Array.from({ length: 3 }, (_, j) => <div key={j} className="p-3"><Bloque className="h-4 w-full max-w-xl" /></div>)}
          </div>
        </section>
      ))}
    </Cargando>
  );
}
