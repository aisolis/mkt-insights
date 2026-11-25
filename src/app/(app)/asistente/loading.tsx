import { Bloque, Cargando } from "@/components/esqueleto";

/**
 * Asistente: saludo, caja de pregunta y sugerencias. Neutro a propósito: también cubre la espera del layout de
 * /asistente/configuracion (este segmento no tiene layout propio).
 */
export default function CargandoAsistente() {
  return (
    <Cargando etiqueta="Cargando el asistente…" className="mx-auto flex max-w-2xl flex-col items-center gap-6 pt-16">
      <Bloque className="h-8 w-64 max-w-full" />
      <Bloque className="h-4 w-80 max-w-full" />
      <Bloque className="h-28 w-full rounded-2xl" />
      <div className="flex w-full flex-wrap justify-center gap-2">
        {Array.from({ length: 4 }, (_, i) => <Bloque key={i} className="h-8 w-40 rounded-full" />)}
      </div>
    </Cargando>
  );
}
