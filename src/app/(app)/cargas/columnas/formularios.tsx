"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HojasSaltadas, NombresColumna } from "./etiquetas";
import { agregarNombreAccion, guardarColumnaAccion, guardarFormatoAccion, probarBorradorAccion, restaurarCampoAccion, revertirCambioAccion, saltarHojaAccion, type Estado } from "./acciones";

function Aviso({ estado }: { estado: Estado }) {
  if (!estado?.error && !estado?.ok) return null;
  return <p role={estado.error ? "alert" : "status"} className={`max-w-prose text-sm ${estado.error ? "text-red-700" : "text-emerald-800"}`}>{estado.error ?? estado.ok}</p>;
}

/** Lista nativa con el mismo aspecto que los campos de texto (foco visible incluido). */
export const CLASE_LISTA = "block h-8 w-full min-w-0 border border-input bg-background px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * Nombres de columna de un dato (etiquetas: el primero es el principal) y si la columna puede faltar. «Probar sin guardar» lee el archivo
 * elegido arriba con este borrador; «Guardar» lo deja para las próximas cargas.
 */
export function FormColumna({ campo, etiqueta, principal, alternativos, obligatoria, puedeFaltar, probarId, archivo, sugeridos }: {
  campo: string; etiqueta: string; principal: string; alternativos: string[]; obligatoria: boolean; puedeFaltar: boolean; probarId: string | null; archivo: string | null;
  /** Columnas del archivo probado que ningún dato usa: se ofrecen para agregarlas con un clic. */
  sugeridos: string[];
}) {
  const [guardado, guardar, guardando] = useActionState(guardarColumnaAccion, null);
  const [prueba, probar, probando] = useActionState(probarBorradorAccion, null);
  return (
    <form action={guardar} className="space-y-3">
      <input type="hidden" name="campo" value={campo} />
      {probarId && <input type="hidden" name="probar" value={probarId} />}
      <NombresColumna inicial={[principal, ...alternativos]} etiqueta={etiqueta} sugeridos={sugeridos} />
      {puedeFaltar && (
        <label className="flex max-w-prose items-start gap-2 text-sm">
          <input type="checkbox" name="puedeFaltar" defaultChecked={!obligatoria} className="mt-1 size-4" />
          <span>Puede faltar en el archivo. Se carga vacía y la carga lo avisa antes de publicar. Sin marcar, una hoja sin esta columna no se carga.</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={guardando}>{guardando ? "Guardando…" : `Guardar ${etiqueta.toLowerCase()}`}</Button>
        {probarId ? (
          <Button type="submit" variant="outline" formAction={probar} disabled={probando}>
            {probando ? "Leyendo el archivo…" : `Probar sin guardar con ${archivo}`}
          </Button>
        ) : (
          <span className="text-xs text-neutral-500">Elige un archivo arriba para probar sin guardar.</span>
        )}
      </div>
      <Aviso estado={prueba} />
      <Aviso estado={guardado} />
    </form>
  );
}

/** Arreglo desde el probador: usar la columna sugerida, o elegir otra de las que sobran, como nombre alternativo. */
export function ArreglarDato({ campo, etiqueta, sugerida, sobran }: { campo: string; etiqueta: string; sugerida: string | null; sobran: string[] }) {
  const [estado, accion, enviando] = useActionState(agregarNombreAccion, null);
  if (!sugerida && !sobran.length) return null;
  return (
    <form action={accion} className="mt-1 space-y-1">
      <input type="hidden" name="campo" value={campo} />
      <div className="flex flex-wrap items-center gap-2">
        {sugerida && (
          <Button type="submit" name="encabezado" value={sugerida} size="sm" className="h-8" disabled={enviando}>
            Usar «{sugerida}» para {etiqueta.toLowerCase()}
          </Button>
        )}
        {sobran.length > 0 && (
          <span className="flex min-w-0 items-center gap-1">
            <label className="sr-only" htmlFor={`sobra-${campo}`}>Otra columna del archivo para {etiqueta}</label>
            <select id={`sobra-${campo}`} name="elegido" defaultValue="" className={`${CLASE_LISTA} max-w-48 text-xs`}>
              <option value="">{sugerida ? "u otra columna…" : "Elegir columna…"}</option>
              {sobran.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Button type="submit" variant="outline" size="sm" className="h-8" disabled={enviando}>Usar</Button>
          </span>
        )}
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

export function SaltarHoja({ hoja }: { hoja: string }) {
  const [estado, accion, enviando] = useActionState(saltarHojaAccion, null);
  return (
    <form action={accion} className="space-y-1">
      <input type="hidden" name="hoja" value={hoja} />
      <Button type="submit" variant="outline" size="sm" className="h-8" disabled={enviando}>Saltar esta hoja siempre</Button>
      <Aviso estado={estado} />
    </form>
  );
}

export function FormFormato({ fila, hojas }: { fila: number; hojas: string[] }) {
  const [estado, accion, enviando] = useActionState(guardarFormatoAccion, null);
  return (
    <form action={accion} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="space-y-1 text-sm">
          <label htmlFor="formato-fila" className="block text-neutral-700">Fila de los encabezados</label>
          <Input id="formato-fila" name="fila" type="number" min={1} max={50} defaultValue={fila} required className="h-8 text-sm md:text-sm" />
          <p className="text-xs text-neutral-500">Las filas de arriba (títulos, filtros) se saltan.</p>
        </div>
        <HojasSaltadas inicial={hojas} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={enviando}>{enviando ? "Guardando…" : "Guardar formato"}</Button>
        <Aviso estado={estado} />
      </div>
    </form>
  );
}

/**
 * Vuelve un dato al nombre del cubo (sin alternativos, obligatorio). Se queda montado aunque ya esté de fábrica para
 * que el aviso de lo que pasó no desaparezca con el botón.
 */
export function RestaurarCampo({ campo, nombreCubo, deFabrica }: { campo: string; nombreCubo: string; deFabrica: boolean }) {
  const [estado, accion, enviando] = useActionState(restaurarCampoAccion, null);
  if (deFabrica) return estado ? <Aviso estado={estado} /> : null;
  return (
    <form action={accion} className="space-y-1 border-t border-neutral-200 pt-3">
      <input type="hidden" name="campo" value={campo} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" disabled={enviando}>{enviando ? "Restaurando…" : `Restaurar «${nombreCubo}»`}</Button>
        <span className="text-xs text-neutral-500">Deja solo el nombre del cubo, sin alternativos y obligatoria.</span>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

/** Deshacer un cambio del historial: vuelve a lo que había antes y deja su propia fila en el historial. */
export function RevertirCambio({ id, disponible }: { id: number; disponible: boolean }) {
  const [estado, accion, enviando] = useActionState(revertirCambioAccion, null);
  if (!disponible) return estado ? <Aviso estado={estado} /> : null;
  return (
    <form action={accion} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="sm" className="h-8" disabled={enviando}>{enviando ? "Deshaciendo…" : "Volver a como estaba"}</Button>
      <Aviso estado={estado} />
    </form>
  );
}
