"use client";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { FilaRegla } from "@/lib/asistente/reglas-servidor";
import type { ReglaAsistente } from "@/lib/asistente/tipos";
import { borrarRegla, cambiarActiva, guardarRegla, type EstadoRegla } from "./acciones";
import { ORDEN_TIPOS, TIPO_INFO } from "./textos";

type Tipo = ReglaAsistente["tipo"];

/** Agregar (sin `regla`) o editar una regla. `onListo` cierra la edición cuando se guardó bien. */
export function FormRegla({ regla, onListo, onCancelar }: { regla?: FilaRegla; onListo?: () => void; onCancelar?: () => void }) {
  const [tipo, setTipo] = useState<Tipo>(regla?.tipo ?? "instruccion");
  const [estado, accion, enviando] = useActionState(async (previo: EstadoRegla, form: FormData) => {
    const r = await guardarRegla(previo, form);
    if (r?.ok) onListo?.();
    return r;
  }, null);
  const info = TIPO_INFO[tipo];
  const nombre = regla ? `regla-${regla.id}` : "regla-nueva";

  return (
    <form action={accion} className="space-y-4">
      {regla && <input type="hidden" name="id" value={regla.id} />}
      <fieldset className="space-y-2">
        <legend className="text-sm text-neutral-700">Tipo de regla</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {ORDEN_TIPOS.map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer flex-col gap-1 border p-3 text-sm ${tipo === t ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 hover:border-neutral-400"}`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} />
                {TIPO_INFO[t].nombre}
              </span>
              <span className="text-xs text-neutral-600">{TIPO_INFO[t].que}</span>
              <span className="text-xs text-neutral-500"><span className="font-medium">Ejemplo:</span> {TIPO_INFO[t].ejemplo}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-1 text-sm" htmlFor={`${nombre}-texto`}>
        <span className="text-neutral-700">{info.campo}</span>
        <Textarea
          id={`${nombre}-texto`}
          name="texto"
          required
          minLength={3}
          maxLength={500}
          rows={2}
          defaultValue={estado?.valores?.texto ?? regla?.texto ?? ""}
          placeholder={tipo === "bloqueo" ? "Los precios de la competencia no están en los datos de venta; pídelos a Insights." : info.ejemplo}
          className="text-sm md:text-sm"
        />
      </label>

      {tipo === "bloqueo" && (
        <label className="block space-y-1 text-sm" htmlFor={`${nombre}-terminos`}>
          <span className="text-neutral-700">Palabras o frases que lo activan (una por línea o separadas por comas)</span>
          <Textarea
            id={`${nombre}-terminos`}
            name="terminos"
            required
            rows={3}
            defaultValue={estado?.valores?.terminos ?? regla?.terminos.join("\n") ?? ""}
            placeholder={"precio de la competencia\nprecios de la competencia"}
            className="text-sm md:text-sm"
          />
          <span className="block text-xs text-neutral-500">
            Se comparan sin tildes ni mayúsculas y como palabra o frase completa: «precio» no bloquea «precios», así que agrega
            las variantes. Evita palabras comunes como «venta» o «canal»: bloquearían casi cualquier pregunta.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={enviando}>{enviando ? "Guardando…" : regla ? "Guardar cambios" : "Agregar regla"}</Button>
        {onCancelar && <Button type="button" variant="ghost" size="lg" onClick={onCancelar}>Cancelar</Button>}
        {(estado?.error || (!regla && estado?.ok)) && (
          <p role={estado.error ? "alert" : "status"} className={`text-sm ${estado.error ? "text-red-700" : "text-emerald-700"}`}>
            {estado.error ?? estado.ok}
          </p>
        )}
      </div>
    </form>
  );
}

/** Una regla de la lista: texto, términos, estado y acciones (activar, editar, eliminar con confirmación). */
export function TarjetaRegla({ regla, cambio }: { regla: FilaRegla; cambio: string }) {
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [activa, enviarActiva, cambiando] = useActionState(cambiarActiva, null);
  const [borrado, enviarBorrado, borrando] = useActionState(borrarRegla, null);

  if (editando) {
    return (
      <li className="bg-neutral-50 p-4">
        <FormRegla regla={regla} onListo={() => setEditando(false)} onCancelar={() => setEditando(false)} />
      </li>
    );
  }

  return (
    <li className={`flex flex-wrap items-start justify-between gap-3 p-3 ${regla.activa ? "" : "bg-neutral-50"}`}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className={`text-sm whitespace-pre-wrap ${regla.activa ? "text-neutral-900" : "text-neutral-500"}`}>{regla.texto}</p>
        {regla.tipo === "bloqueo" && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-neutral-500">
            Se activa con:
            {regla.terminos.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
          </div>
        )}
        <p className="text-xs text-neutral-500">{cambio}</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={regla.activa ? "default" : "outline"}>{regla.activa ? "Activa" : "Inactiva"}</Badge>
          <form action={enviarActiva}>
            <input type="hidden" name="id" value={regla.id} />
            <input type="hidden" name="activa" value={regla.activa ? "no" : "si"} />
            <Button type="submit" variant="outline" size="xs" disabled={cambiando}>{regla.activa ? "Desactivar" : "Activar"}</Button>
          </form>
          <Button variant="outline" size="xs" onClick={() => setEditando(true)}>Editar</Button>
          {!confirmando && <Button variant="outline" size="xs" onClick={() => setConfirmando(true)}>Eliminar</Button>}
        </div>
        {confirmando && (
          <form action={enviarBorrado} className="flex flex-wrap items-center justify-end gap-2 text-xs">
            <input type="hidden" name="id" value={regla.id} />
            <span className="text-neutral-700">¿Eliminar esta regla? No se puede deshacer (queda en el historial).</span>
            <Button type="submit" variant="destructive" size="xs" disabled={borrando}>{borrando ? "Eliminando…" : "Sí, eliminar"}</Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => setConfirmando(false)}>Cancelar</Button>
          </form>
        )}
        {(activa?.error || borrado?.error) && <span role="alert" className="max-w-64 text-right text-xs text-red-700">{activa?.error ?? borrado?.error}</span>}
      </div>
    </li>
  );
}
