"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FilaPresupuesto, Solicitud } from "@/lib/asistente/presupuesto";
import { guardarDePersona, guardarGeneral, resolver, type EstadoPresupuestos } from "./acciones";

function Aviso({ estado }: { estado: EstadoPresupuestos }) {
  if (!estado?.error && !estado?.ok) return null;
  return <p role={estado.error ? "alert" : "status"} className={`text-sm ${estado.error ? "text-red-700" : "text-emerald-700"}`}>{estado.error ?? estado.ok}</p>;
}

const aTexto = (n: number | null) => (n === null ? "" : n.toFixed(2));

/** Presupuesto mensual que tiene cada persona si no se le fija uno propio. */
export function FormGeneral({ monto }: { monto: number | null }) {
  const [estado, accion, enviando] = useActionState(guardarGeneral, null);
  const [valor, setValor] = useState(aTexto(monto));
  const [base, setBase] = useState(monto);
  // Al guardar llega el monto nuevo: el campo lo muestra como quedó («0,5» pasa a «0.50») y el aviso sigue visible.
  if (base !== monto) {
    setBase(monto);
    setValor(aTexto(monto));
  }
  const cambio = valor.trim() !== aTexto(monto);
  return (
    <form action={accion} className="space-y-2">
      <label htmlFor="presupuesto-general" className="block text-sm font-semibold">Presupuesto mensual por persona</label>
      <p className="max-w-prose text-xs text-neutral-500">
        Lo que cada persona puede gastar en IA al mes, salvo que tenga uno propio. Al agotarlo, el asistente le responde con el análisis automático
        por reglas (mismas cifras) y puede pedir una ampliación. Déjalo vacío para no limitar por persona.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-600">US$</span>
        <Input id="presupuesto-general" name="monto" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="sin límite" className="h-9 w-32 tabular-nums" />
        <Button type="submit" size="lg" disabled={enviando || !cambio}>{enviando ? "Guardando…" : "Guardar"}</Button>
        {!cambio && <Aviso estado={estado} />}
        {cambio && estado?.error && <Aviso estado={estado} />}
      </div>
    </form>
  );
}

/** Aprobar con un monto (vale solo ese mes) o rechazar, con una nota opcional para la persona. */
export function FormResolver({ solicitud, sugerido }: { solicitud: Solicitud; sugerido: number | null }) {
  const [estado, accion, enviando] = useActionState(resolver, null);
  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="id" value={solicitud.id} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs text-neutral-700">
          <span className="block">Monto extra para este mes (US$)</span>
          <Input name="monto" inputMode="decimal" defaultValue={aTexto(sugerido)} aria-label={`Monto extra para ${solicitud.nombre}`} className="h-8 w-28 tabular-nums" />
        </label>
        <label className="min-w-0 flex-1 basis-56 space-y-1 text-xs text-neutral-700">
          <span className="block">Nota para la persona (opcional)</span>
          <Input name="respuesta" maxLength={500} className="h-8" />
        </label>
        <Button type="submit" name="decision" value="aprobar" size="sm" className="h-8" disabled={enviando}>Aprobar</Button>
        <Button type="submit" name="decision" value="rechazar" variant="outline" size="sm" className="h-8" disabled={enviando}>Rechazar</Button>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

/** Presupuesto de una persona: el general, uno propio o sin límite. */
export function FormPersona({ fila, general }: { fila: FilaPresupuesto; general: number | null }) {
  const [estado, accion, enviando] = useActionState(guardarDePersona, null);
  const [abierto, setAbierto] = useState(false);
  // «Sin límite» porque el general no limita no es una elección propia de la persona.
  const actual = fila.origen === "sin_limite" && general === null ? "general" : fila.origen;
  const [tipo, setTipo] = useState(actual);
  if (!abierto) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <Button type="button" variant="outline" size="xs" onClick={() => setAbierto(true)}>Cambiar</Button>
        <Aviso estado={estado} />
      </span>
    );
  }
  return (
    <form action={async (f) => { await accion(f); setAbierto(false); }} className="space-y-2 text-xs">
      <input type="hidden" name="usuario" value={fila.usuario_id} />
      <fieldset className="space-y-1">
        <legend className="sr-only">Presupuesto de {fila.nombre}</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="tipo" value="general" checked={tipo === "general"} onChange={() => setTipo("general")} />
          El general ({general === null ? "sin límite" : `US$ ${general.toFixed(2)}`})
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="tipo" value="propio" checked={tipo === "propio"} onChange={() => setTipo("propio")} />
          Uno propio: US$
          <Input name="monto" inputMode="decimal" defaultValue={fila.origen === "propio" ? aTexto(fila.base_usd) : ""} disabled={tipo !== "propio"}
            aria-label={`Presupuesto mensual de ${fila.nombre}`} className="h-7 w-24 tabular-nums" />
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="tipo" value="sin_limite" checked={tipo === "sin_limite"} onChange={() => setTipo("sin_limite")} />
          Sin límite
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="xs" disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</Button>
        <Button type="button" variant="ghost" size="xs" onClick={() => { setAbierto(false); setTipo(actual); }}>Cancelar</Button>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}
