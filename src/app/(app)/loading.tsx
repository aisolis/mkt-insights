import { Bloque, Cargando, EsqueletoEncabezado, EsqueletoSeccion, EsqueletoTarjetas } from "@/components/esqueleto";

/** Dashboard: título, filtros, KPI y secciones mientras llega la versión vigente. */
export default function CargandoInicio() {
  return (
    <Cargando etiqueta="Cargando el desempeño comercial…" className="space-y-6">
      <EsqueletoEncabezado />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-1">
            <Bloque className="h-3 w-16" />
            <Bloque className="h-9 w-full" />
          </div>
        ))}
      </div>
      <EsqueletoTarjetas />
      <EsqueletoSeccion filas={2} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <EsqueletoSeccion grafica />
        <EsqueletoSeccion grafica />
      </div>
    </Cargando>
  );
}
