"use client";
import { Popover } from "@base-ui/react/popover";
import { BookmarkSimpleIcon, CheckIcon, PencilSimpleIcon, TrashIcon, UsersThreeIcon, XIcon } from "@phosphor-icons/react";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { leerParams, queryString, type EstadoDashboard } from "@/lib/dashboard/params";
import { borrarVista, editarVista, guardarVista, listarVistas } from "@/lib/dashboard/vistas";
import { MAX_NOMBRE_VISTA, resumenVista, tienePeriodo, vistaActiva, type VistaGuardada } from "@/lib/dashboard/vistas-consulta";
import { capital, periodoCorto } from "@/lib/format";
import type { PeriodoMeta } from "@/lib/semantic/contracts";

/**
 * "Vistas" de la barra de filtros (G9): aplicar una vista guardada, guardar los filtros de ahora como vista nueva,
 * renombrar, compartir y borrar las propias, y ver las que comparte el equipo. Las vistas se cargan al abrir.
 */
export function Vistas({ estado, periodos, navegar }: {
  estado: EstadoDashboard;
  periodos: PeriodoMeta[];
  navegar: (consulta: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [vistas, setVistas] = useState<VistaGuardada[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, startCarga] = useTransition();
  const actual = queryString(estado);

  const cargar = () => startCarga(async () => {
    const r = await listarVistas();
    if (!r.ok) setError(r.error); else { setVistas(r.vistas); setError(null); }
  });
  const aplicar = (v: VistaGuardada) => { setAbierto(false); navegar(v.consulta); };
  const reemplazar = (v: VistaGuardada) => setVistas((xs) => (xs ?? []).map((x) => (x.id === v.id ? v : x)));

  const propias = vistas?.filter((v) => v.propia) ?? [];
  const equipo = vistas?.filter((v) => !v.propia) ?? [];

  return (
    <Popover.Root open={abierto} onOpenChange={(o) => { setAbierto(o); if (o) cargar(); }}>
      <Popover.Trigger render={<Button variant="outline" size="sm" className="bg-white" />}>
        <BookmarkSimpleIcon /> Vistas
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-50">
          <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] max-h-(--available-height) overflow-y-auto bg-popover text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
            <Popover.Title className="border-b px-3 py-2 text-sm font-medium">Vistas guardadas</Popover.Title>

            <div className="space-y-3 px-3 py-2" aria-busy={cargando}>
              {error && <p role="alert" className="text-red-700">{error}</p>}
              {vistas === null && !error && <p className="text-neutral-500">Cargando…</p>}
              {vistas !== null && (
                <>
                  <Seccion titulo="Mis vistas">
                    {propias.length === 0
                      ? <p className="py-1 text-neutral-500">Aún no tienes vistas. Guarda los filtros de ahora para volver a ellos con un clic.</p>
                      : propias.map((v) => (
                        <FilaPropia key={v.id} vista={v} activa={vistaActiva(v.consulta, actual, periodos)} onAplicar={() => aplicar(v)}
                          onCambio={reemplazar} onBorrada={() => setVistas((xs) => (xs ?? []).filter((x) => x.id !== v.id))} />
                      ))}
                  </Seccion>
                  {equipo.length > 0 && (
                    <Seccion titulo="Compartidas por el equipo">
                      {equipo.map((v) => (
                        <Aplicar key={v.id} vista={v} activa={vistaActiva(v.consulta, actual, periodos)} onAplicar={() => aplicar(v)}
                          detalle={`${v.autor ? `De ${v.autor} · ` : ""}${resumenVista(v.consulta)}`} />
                      ))}
                    </Seccion>
                  )}
                </>
              )}
            </div>

            <NuevaVista estado={estado} periodos={periodos} onGuardada={(v) => setVistas((xs) => [v, ...(xs ?? [])])} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-[11px] font-medium tracking-wide text-neutral-500 uppercase">{titulo}</h3>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

/** Botón que aplica la vista (nombre + resumen). */
function Aplicar({ vista, activa, detalle, onAplicar, children }: {
  vista: VistaGuardada; activa: boolean; detalle: string; onAplicar: () => void; children?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1">
      <button type="button" onClick={onAplicar} aria-current={activa || undefined}
        className="min-w-0 flex-1 px-1.5 py-1 text-left hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none">
        <span className="flex items-center gap-1 font-medium">
          <span className="truncate">{vista.nombre}</span>
          {activa && <CheckIcon className="size-3.5 shrink-0" aria-label="En pantalla" />}
        </span>
        <span className="block truncate text-neutral-500">{detalle}</span>
      </button>
      {children}
    </li>
  );
}

function FilaPropia({ vista, activa, onAplicar, onCambio, onBorrada }: {
  vista: VistaGuardada; activa: boolean; onAplicar: () => void; onCambio: (v: VistaGuardada) => void; onBorrada: () => void;
}) {
  const [modo, setModo] = useState<"ver" | "renombrar" | "borrar">("ver");
  const [nombre, setNombre] = useState(vista.nombre);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  const editar = (cambios: { nombre?: string; compartida?: boolean }) => start(async () => {
    const r = await editarVista(vista.id, cambios);
    if (!r.ok) { setError(r.error); return; }
    setError(null); setModo("ver"); onCambio(r.vista);
  });
  const borrar = () => start(async () => {
    const r = await borrarVista(vista.id);
    if (!r.ok) setError(r.error); else onBorrada();
  });

  if (modo === "renombrar") {
    return (
      <li>
        <form className="flex items-center gap-1 py-0.5" onSubmit={(e) => { e.preventDefault(); editar({ nombre }); }}>
          <Input aria-label="Nombre de la vista" value={nombre} maxLength={MAX_NOMBRE_VISTA} autoFocus onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setModo("ver"); setNombre(vista.nombre); } }} />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Guardar nombre" disabled={pendiente}><CheckIcon /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => { setModo("ver"); setNombre(vista.nombre); setError(null); }}><XIcon /></Button>
        </form>
        {error && <p role="alert" className="px-1.5 text-red-700">{error}</p>}
      </li>
    );
  }

  return (
    <>
      <Aplicar vista={vista} activa={activa} onAplicar={onAplicar}
        detalle={`${vista.compartida ? "Compartida · " : ""}${resumenVista(vista.consulta)}`}>
        {modo === "borrar" ? (
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-neutral-600">¿Borrar?</span>
            <Button size="xs" variant="destructive" disabled={pendiente} onClick={borrar}>Sí</Button>
            <Button size="xs" variant="ghost" onClick={() => setModo("ver")}>No</Button>
          </span>
        ) : (
          <span className={`flex shrink-0 items-center ${pendiente ? "opacity-60" : ""}`}>
            <Button size="icon-sm" variant="ghost" disabled={pendiente} aria-pressed={vista.compartida}
              aria-label={vista.compartida ? "Dejar de compartir con el equipo" : "Compartir con el equipo"}
              title={vista.compartida ? "Compartida con el equipo (clic para dejar de compartir)" : "Compartir con el equipo"}
              onClick={() => editar({ compartida: !vista.compartida })}>
              <UsersThreeIcon weight={vista.compartida ? "fill" : "regular"} />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Renombrar" title="Renombrar" onClick={() => { setError(null); setModo("renombrar"); }}><PencilSimpleIcon /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Borrar" title="Borrar" onClick={() => { setError(null); setModo("borrar"); }}><TrashIcon /></Button>
          </span>
        )}
      </Aplicar>
      {error && <li role="alert" className="px-1.5 text-red-700">{error}</li>}
    </>
  );
}

function NuevaVista({ estado, periodos, onGuardada }: { estado: EstadoDashboard; periodos: PeriodoMeta[]; onGuardada: (v: VistaGuardada) => void }) {
  const id = useId();
  // Si en pantalla está el periodo por defecto (último mes cerrado), lo natural es que la vista lo siga.
  const porDefecto = leerParams({}, periodos).periodo;
  const enUltimo = porDefecto.anio === estado.periodo.anio && porDefecto.mes === estado.periodo.mes;
  const [nombre, setNombre] = useState("");
  const [fijar, setFijar] = useState(!enUltimo);
  const [compartida, setCompartida] = useState(false);
  const [aviso, setAviso] = useState<{ error?: string; ok?: string } | null>(null);
  const [pendiente, start] = useTransition();
  const periodoTxt = capital(periodoCorto(estado.periodo));

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await guardarVista({ nombre, consulta: queryString(estado), compartida, fijarPeriodo: fijar });
      if (!r.ok) { setAviso({ error: r.error }); return; }
      onGuardada(r.vista);
      setNombre(""); setCompartida(false);
      setAviso({ ok: `Vista guardada${tienePeriodo(r.vista.consulta) ? ` con ${periodoTxt}` : ""}.` });
    });
  };

  return (
    <form onSubmit={guardar} className="space-y-2 border-t px-3 py-3">
      <label htmlFor={`${id}-nombre`} className="block font-medium">Guardar los filtros de ahora</label>
      <Input id={`${id}-nombre`} placeholder="Ej. Mayoreo zona norte" value={nombre} maxLength={MAX_NOMBRE_VISTA} required
        onChange={(e) => { setNombre(e.target.value); setAviso(null); }} />
      <fieldset className="space-y-1">
        <legend className="sr-only">Periodo de la vista</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name={`${id}-periodo`} checked={!fijar} onChange={() => setFijar(false)} className="accent-neutral-900" />
          Siempre el último mes
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name={`${id}-periodo`} checked={fijar} onChange={() => setFijar(true)} className="accent-neutral-900" />
          Fijar el periodo ({periodoTxt})
        </label>
      </fieldset>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={compartida} onChange={(e) => setCompartida(e.target.checked)} className="accent-neutral-900" />
        Compartir con el equipo
      </label>
      <div className="flex items-center justify-between gap-2">
        <p role="status" className={aviso?.error ? "text-red-700" : "text-neutral-500"}>{aviso?.error ?? aviso?.ok ?? ""}</p>
        <Button type="submit" size="sm" disabled={pendiente || !nombre.trim()}>{pendiente ? "Guardando…" : "Guardar vista"}</Button>
      </div>
    </form>
  );
}
