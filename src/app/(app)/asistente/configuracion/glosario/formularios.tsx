"use client";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FilaGlosario } from "@/lib/asistente/glosario-servidor";
import { borrarTermino, cambiarActivo, cargarGlosario, guardarTermino, type EstadoTermino } from "./acciones";

/** Agregar (sin `termino`) o editar un término. `onListo` cierra la edición cuando se guardó bien. */
export function FormTermino({ termino, onListo, onCancelar }: { termino?: FilaGlosario; onListo?: () => void; onCancelar?: () => void }) {
  const [estado, accion, enviando] = useActionState(async (previo: EstadoTermino, form: FormData) => {
    const r = await guardarTermino(previo, form);
    if (r?.ok) onListo?.();
    return r;
  }, null);
  const nombre = termino ? `termino-${termino.id}` : "termino-nuevo";
  // Tras guardar uno nuevo el formulario queda vacío; tras un error conserva lo escrito.
  const previo = estado?.error ? estado.valores : undefined;

  return (
    <form action={accion} className="space-y-3">
      {termino && <input type="hidden" name="id" value={termino.id} />}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1 text-sm" htmlFor={`${nombre}-termino`}>
          <span className="text-neutral-700">Término</span>
          <Input id={`${nombre}-termino`} name="termino" required minLength={2} maxLength={80} defaultValue={previo?.termino ?? termino?.termino ?? ""} placeholder="Ticket" className="h-9" />
        </label>
        <label className="block space-y-1 text-sm" htmlFor={`${nombre}-sinonimos`}>
          <span className="text-neutral-700">Otras formas de decirlo (opcional, separadas por comas)</span>
          <Input id={`${nombre}-sinonimos`} name="sinonimos" maxLength={1200} defaultValue={previo?.sinonimos ?? termino?.sinonimos.join(", ") ?? ""} placeholder="ticket promedio, factura promedio" className="h-9" />
        </label>
      </div>
      <label className="block space-y-1 text-sm" htmlFor={`${nombre}-definicion`}>
        <span className="text-neutral-700">Definición</span>
        <Textarea id={`${nombre}-definicion`} name="definicion" required minLength={3} maxLength={500} rows={2} defaultValue={previo?.definicion ?? termino?.definicion ?? ""}
          placeholder="Venta neta dividida entre el número de facturas del periodo." className="text-sm md:text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={enviando}>{enviando ? "Guardando…" : termino ? "Guardar cambios" : "Agregar término"}</Button>
        {onCancelar && <Button type="button" variant="ghost" size="lg" onClick={onCancelar}>Cancelar</Button>}
        {(estado?.error || (!termino && estado?.ok)) && (
          <p role={estado.error ? "alert" : "status"} className={`text-sm ${estado.error ? "text-red-700" : "text-emerald-700"}`}>{estado.error ?? estado.ok}</p>
        )}
      </div>
    </form>
  );
}

/** Carga de un Excel o CSV con muchos términos. Si alguna fila está mal no se guarda nada y se listan las filas. */
export function FormCargar() {
  const [estado, accion, enviando] = useActionState(cargarGlosario, null);
  return (
    <form action={accion} className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span className="text-neutral-700">Archivo Excel (.xlsx) o CSV, con las columnas «Término», «Definición» y, opcional, «Sinónimos»</span>
        <input name="archivo" type="file" required accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="block w-full text-sm" />
      </label>
      <p className="text-xs text-neutral-500">
        Los términos que ya existen se actualizan con lo que traiga el archivo; los demás se agregan. No se elimina ninguno.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" size="lg" disabled={enviando}>{enviando ? "Cargando…" : "Cargar archivo"}</Button>
        {(estado?.error || estado?.ok) && (
          <p role={estado.error ? "alert" : "status"} className={`text-sm ${estado.error ? "text-red-700" : "text-emerald-700"}`}>{estado.error ?? estado.ok}</p>
        )}
      </div>
      {estado?.errores && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-700">
          {estado.errores.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </form>
  );
}

/** Un término de la lista: definición, sinónimos, estado y acciones. */
export function TarjetaTermino({ termino, cambio }: { termino: FilaGlosario; cambio: string }) {
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [activo, enviarActivo, cambiando] = useActionState(cambiarActivo, null);
  const [borrado, enviarBorrado, borrando] = useActionState(borrarTermino, null);

  if (editando) {
    return (
      <li className="bg-neutral-50 p-4">
        <FormTermino termino={termino} onListo={() => setEditando(false)} onCancelar={() => setEditando(false)} />
      </li>
    );
  }

  return (
    <li className={`flex flex-wrap items-start justify-between gap-3 p-3 ${termino.activo ? "" : "bg-neutral-50"}`}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className={`text-sm ${termino.activo ? "text-neutral-900" : "text-neutral-500"}`}>
          <span className="font-medium">{termino.termino}</span>: {termino.definicion}
        </p>
        {termino.sinonimos.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-neutral-500">
            También:
            {termino.sinonimos.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
          </div>
        )}
        <p className="text-xs text-neutral-500">{cambio}</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {!termino.activo && <Badge variant="outline">Inactivo</Badge>}
          <form action={enviarActivo}>
            <input type="hidden" name="id" value={termino.id} />
            <input type="hidden" name="activo" value={termino.activo ? "no" : "si"} />
            <Button type="submit" variant="outline" size="xs" disabled={cambiando}>{termino.activo ? "Desactivar" : "Activar"}</Button>
          </form>
          <Button variant="outline" size="xs" onClick={() => setEditando(true)}>Editar</Button>
          {!confirmando && <Button variant="outline" size="xs" onClick={() => setConfirmando(true)}>Eliminar</Button>}
        </div>
        {confirmando && (
          <form action={enviarBorrado} className="flex flex-wrap items-center justify-end gap-2 text-xs">
            <input type="hidden" name="id" value={termino.id} />
            <span className="text-neutral-700">¿Eliminar «{termino.termino}»? No se puede deshacer.</span>
            <Button type="submit" variant="destructive" size="xs" disabled={borrando}>{borrando ? "Eliminando…" : "Sí, eliminar"}</Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => setConfirmando(false)}>Cancelar</Button>
          </form>
        )}
        {(activo?.error || borrado?.error) && <span role="alert" className="max-w-64 text-right text-xs text-red-700">{activo?.error ?? borrado?.error}</span>}
      </div>
    </li>
  );
}
