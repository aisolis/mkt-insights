import { Bloque, Cargando, EsqueletoEncabezado, EsqueletoFilas } from "@/components/esqueleto";

/** Columnas del Excel: prueba con un archivo, formato y la lista de columnas. */
export default function CargandoColumnas() {
  return (
    <Cargando etiqueta="Cargando columnas del Excel…" className="space-y-8">
      <div className="space-y-2">
        <Bloque className="h-3 w-36" />
        <EsqueletoEncabezado />
      </div>
      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <Bloque className="h-4 w-52" />
        <Bloque className="h-9 w-full max-w-md" />
      </section>
      <section className="space-y-3">
        <Bloque className="h-4 w-48" />
        <div className="border border-neutral-200 bg-white p-4"><EsqueletoFilas filas={8} columnas={3} /></div>
      </section>
    </Cargando>
  );
}
