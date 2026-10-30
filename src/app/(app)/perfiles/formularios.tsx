"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accionUsuario, invitarUsuario } from "./acciones";

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
