import { Bloque, Cargando, EsqueletoEncabezado } from "@/components/esqueleto";

/** Glosario del asistente (el título y las pestañas ya los pinta el layout). */
export default function CargandoGlosario() {
  return (
    <Cargando etiqueta="Cargando glosario…" className="space-y-6">
      <EsqueletoEncabezado nivel="seccion" />
      {Array.from({ length: 2 }, (_, i) => (
        <section key={i} className="space-y-3 border border-neutral-200 bg-white p-4">
          <Bloque className="h-4 w-44" />
          <Bloque className="h-16 w-full" />
        </section>
      ))}
      <section className="space-y-2">
        <Bloque className="h-4 w-32" />
        <div className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
          {Array.from({ length: 5 }, (_, j) => <div key={j} className="p-3"><Bloque className="h-4 w-full max-w-xl" /></div>)}
        </div>
      </section>
    </Cargando>
  );
}
