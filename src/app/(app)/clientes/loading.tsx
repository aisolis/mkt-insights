import { Bloque, Cargando, EsqueletoEncabezado, EsqueletoSeccion } from "@/components/esqueleto";

/** Clientes: seis tarjetas de estado, la explicación plegada y la lista. */
export default function CargandoClientes() {
  return (
    <Cargando etiqueta="Cargando clientes…" className="space-y-6">
      <EsqueletoEncabezado />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-lg border border-neutral-200 bg-white p-3">
            <Bloque className="h-4 w-20" />
            <Bloque className="mt-2 h-7 w-14" />
            <Bloque className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-neutral-200 bg-white p-4"><Bloque className="h-4 w-56" /></div>
      <EsqueletoSeccion filas={10} columnas={6} />
    </Cargando>
  );
}
