"use client";
import { useActionState, useMemo, useState } from "react";
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
        <input type="checkbox" name="esAdmin" className="size-4" /> Admin
      </label>
      <Button type="submit" size="lg" disabled={enviando}>{enviando ? "Enviando…" : "Invitar"}</Button>
      <p className="text-xs text-neutral-500 sm:col-span-5">
        Entra viendo toda la venta interna y sin permiso de publicar versiones; el ámbito y los permisos se ajustan después en su fila.
      </p>
      {(estado?.error || estado?.ok) && (
        <p role={estado.error ? "alert" : "status"} className={`text-sm sm:col-span-5 ${estado.error ? "text-red-700" : "text-emerald-700"}`}>
          {estado.error ?? estado.ok}
        </p>
      )}
    </form>
  );
}

/**
 * Un cambio de acceso de una persona, con su resultado en línea. Con `confirmar` (lo que la persona pierde), el primer
 * clic pide confirmación en el mismo lugar: quitar acceso nunca pasa por un solo clic.
 */
export function AccionUsuario({ userId, nombre, accion, valor, confirmar, si, peligro, children }: {
  userId: string; nombre: string; accion: string; valor?: string; confirmar?: string; si?: string; peligro?: boolean; children: React.ReactNode;
}) {
  const [estado, enviar, enviando] = useActionState(accionUsuario, null);
  const [preguntando, setPreguntando] = useState(false);
  const variante = peligro ? "destructive" : "outline";
  return (
    <form action={(f) => { setPreguntando(false); enviar(f); }} className="flex flex-col items-start gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="accion" value={accion} />
      {valor && <input type="hidden" name="valor" value={valor} />}
      {confirmar && !preguntando ? (
        <Button type="button" variant={variante} disabled={enviando} onClick={() => setPreguntando(true)}>
          {children}<span className="sr-only"> a {nombre}</span>
        </Button>
      ) : confirmar ? (
        <div role="group" aria-label={`Confirmar: ${nombre}`} className="max-w-sm space-y-2 border border-neutral-300 bg-white p-2 text-sm">
          <p>{confirmar}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={variante} disabled={enviando} autoFocus>{enviando ? "Guardando…" : si ?? "Confirmar"}</Button>
            <Button type="button" variant="ghost" onClick={() => setPreguntando(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button type="submit" variant={variante} disabled={enviando}>
          {enviando ? "Guardando…" : children}<span className="sr-only"> a {nombre}</span>
        </Button>
      )}
      {(estado?.error || estado?.ok) && (
        <span role={estado.error ? "alert" : "status"} className={`max-w-60 text-xs ${estado.error ? "text-red-700" : "text-emerald-700"}`}>
          {estado.error ?? estado.ok}
        </span>
      )}
    </form>
  );
}

const CLASE_CASILLA = "inline-flex min-h-8 items-center gap-2";

/**
 * Ámbito de datos (V1-02): qué empresas, canales y rutas ve la persona. Sin marcar nada en un grupo = todo ese grupo. La
 * base lo aplica en cada consulta (dashboard, asistente, clientes, exportaciones). Las rutas se eligen con un filtro y un
 * contador; las elegidas viajan aparte, así que filtrar nunca borra una elección.
 */
export function FormAlcance({ userId, nombre, alcance, opciones }: { userId: string; nombre: string; alcance: Alcance; opciones: OpcionesAlcance | null }) {
  const [estado, accion, enviando] = useActionState(guardarAlcanceAccion, null);
  const [rutas, setRutas] = useState<Set<string>>(() => new Set(alcance?.ruta ?? []));
  const [filtro, setFiltro] = useState("");
  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    // Las líneas sin ruta no se pueden elegir como ámbito: no tienen nombre que guardar.
    return (opciones?.ruta ?? []).filter((r) => r && (!f || r.toLowerCase().includes(f)));
  }, [filtro, opciones]);
  const totalRutas = opciones?.ruta.filter(Boolean).length ?? 0;
  if (!opciones) return <p role="alert" className="text-sm text-red-700">No se pudieron cargar las opciones del ámbito. Recarga la página.</p>;
  const marcado = (dim: "empresa" | "canal", v: string) => !!alcance?.[dim]?.includes(v);
  const alternar = (r: string) => setRutas((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; });
  return (
    <form action={accion} className="w-full basis-full space-y-3">
      <input type="hidden" name="userId" value={userId} />
      {[...rutas].map((r) => <input key={r} type="hidden" name="ruta" value={r} />)}
      <p className="max-w-prose text-sm text-neutral-600">
        Qué parte de la venta ve {nombre}. Sin marcar nada en un grupo, ve todo ese grupo; los grupos se combinan (p. ej. canal Detalle y empresa MCM =
        solo Detalle de MCM). Vale desde su próxima consulta.
      </p>
      {(["empresa", "canal"] as const).map((dim) => (
        <fieldset key={dim} className="space-y-1">
          <legend className="text-sm font-medium">{dim === "empresa" ? "Empresas" : "Canales"}</legend>
          <div className="flex flex-wrap gap-x-4">
            {opciones[dim].map((v) => (
              <label key={v} className={`${CLASE_CASILLA} text-sm`}>
                <input type="checkbox" name={dim} value={v} defaultChecked={marcado(dim, v)} className="size-4" />{v}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Rutas</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar rutas" aria-label="Filtrar rutas" className="h-8 w-56" />
          <span aria-live="polite" className="text-sm text-neutral-600 tabular-nums">
            {rutas.size ? `${rutas.size} de ${totalRutas} rutas elegidas` : `Ninguna elegida: ve todas las rutas`}
          </span>
          {rutas.size > 0 && <Button type="button" variant="ghost" onClick={() => setRutas(new Set())}>Quitar todas</Button>}
        </div>
        <div className="max-h-56 overflow-y-auto border border-neutral-200 bg-white px-2">
          {visibles.length === 0 && <p className="py-2 text-sm text-neutral-500">Ninguna ruta coincide con «{filtro}».</p>}
          <div className="grid gap-x-4 sm:grid-cols-2">
            {visibles.map((r) => (
              <label key={r} className={`${CLASE_CASILLA} min-w-0 text-sm`}>
                <input type="checkbox" checked={rutas.has(r)} onChange={() => alternar(r)} className="size-4 shrink-0" />
                <span className="truncate">{r}</span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={enviando}>{enviando ? "Guardando…" : "Guardar ámbito"}</Button>
        {alcance && <Button type="submit" name="todo" value="si" variant="outline" disabled={enviando}>Quitar el límite (ve toda la venta)</Button>}
      </div>
      {estado && <p role={estado.error ? "alert" : "status"} className={`text-sm ${estado.error ? "text-red-700" : "text-emerald-700"}`}>{estado.error ?? estado.ok}</p>}
    </form>
  );
}
