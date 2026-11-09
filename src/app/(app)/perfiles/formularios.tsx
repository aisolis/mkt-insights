"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Alcance, OpcionesAlcance } from "@/lib/auth/admin";
import { accionUsuario, guardarAlcanceAccion, invitarUsuario } from "./acciones";

export function FormInvitar() {
  const [estado, accion, enviando] = useActionState(invitarUsuario, null);
  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end">
      <label className="space-y-1 text-sm">
        <span className="text-neutral-700">Correo</span>
        <Input name="email" type="email" required className="h-9" />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-neutral-700">Nombre</span>
        <Input name="nombre" required minLength={2} maxLength={80} className="h-9" />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-neutral-700">Perfil</span>
        <select name="nivel" defaultValue="estandar" className="block h-9 border border-input bg-background px-2 text-sm">
          <option value="estandar">Estándar</option>
          <option value="plus">Plus</option>
        </select>
      </label>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input type="checkbox" name="esAdmin" /> Admin
      </label>
      <Button type="submit" size="lg" disabled={enviando}>{enviando ? "Enviando…" : "Invitar"}</Button>
      {(estado?.error || estado?.ok) && (
        <p role={estado.error ? "alert" : "status"} className={`text-sm sm:col-span-5 ${estado.error ? "text-red-700" : "text-emerald-700"}`}>
          {estado.error ?? estado.ok}
        </p>
      )}
    </form>
  );
}

/** Un botón de acción por usuario (cambiar perfil, admin, activar, reenviar), con su error en línea. */
export function AccionUsuario({ userId, accion, valor, children }: { userId: string; accion: string; valor?: string; children: React.ReactNode }) {
  const [estado, enviar, enviando] = useActionState(accionUsuario, null);
  return (
    <form action={enviar} className="inline-flex flex-col items-start">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="accion" value={accion} />
      {valor && <input type="hidden" name="valor" value={valor} />}
      <Button type="submit" variant="outline" size="xs" disabled={enviando}>{children}</Button>
      {estado?.error && <span role="alert" className="mt-1 max-w-48 text-xs text-red-700">{estado.error}</span>}
    </form>
  );
}

/**
 * Ámbito de datos (V1-02): qué empresas, canales y rutas ve la persona. Sin marcar nada en una dimensión = todas. La base
 * lo aplica en cada consulta (dashboard, asistente, clientes, exportaciones).
 */
export function FormAlcance({ userId, alcance, opciones, resumen }: { userId: string; alcance: Alcance; opciones: OpcionesAlcance; resumen: string }) {
  const [estado, accion, enviando] = useActionState(guardarAlcanceAccion, null);
  const marcado = (dim: "empresa" | "canal" | "ruta", v: string) => !!alcance?.[dim]?.includes(v);
  return (
    <details className="mt-1 text-xs">
      <summary className="inline-flex min-h-8 cursor-pointer items-center text-neutral-600 underline underline-offset-2">Ámbito: {resumen}</summary>
      <form action={accion} className="mt-2 w-80 max-w-full space-y-2 border border-neutral-200 bg-neutral-50 p-2">
        <input type="hidden" name="userId" value={userId} />
        <p className="text-neutral-600">Marca lo que puede ver. Sin marcar nada en un grupo = todo ese grupo.</p>
        {(["empresa", "canal"] as const).map((dim) => (
          <fieldset key={dim} className="space-y-1">
            <legend className="font-medium">{dim === "empresa" ? "Empresas" : "Canales"}</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {opciones[dim].map((v) => (
                <label key={v} className="inline-flex items-center gap-1">
                  <input type="checkbox" name={dim} value={v} defaultChecked={marcado(dim, v)} className="size-4" />{v}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <label className="block space-y-1">
          <span className="font-medium">Rutas</span>
          <select name="ruta" multiple defaultValue={alcance?.ruta ?? []} className="block h-32 w-full border border-neutral-300 bg-white text-xs">
            {opciones.ruta.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <span className="text-neutral-500">Ctrl o Cmd para elegir varias.</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={enviando}>Guardar ámbito</Button>
          {alcance && <Button type="submit" name="todo" value="si" variant="ghost" disabled={enviando}>Ver todo</Button>}
        </div>
        {estado && <p role={estado.error ? "alert" : "status"} className={estado.error ? "text-red-700" : "text-emerald-700"}>{estado.error ?? estado.ok}</p>}
      </form>
    </details>
  );
}

