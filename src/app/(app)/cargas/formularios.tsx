"use client";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BUCKET_CARGAS, MAX_BYTES_CARGA, MIME_XLSX } from "@/lib/cargas/tipos";
import { createClient } from "@/lib/supabase/client";
import { anularAprobacionCarga, aprobarCarga, conciliarVersion, descartarCarga, prepararCargaAccion, publicarCarga, retirarVersion, type Estado } from "./acciones";

type Paso = { tipo: "listo" | "error" | "trabajando"; texto: string } | null;

function Aviso({ paso }: { paso: Paso | Estado }) {
  if (!paso) return null;
  const error = "tipo" in paso ? paso.tipo === "error" : !!paso.error;
  const texto = "tipo" in paso ? paso.texto : paso.error ?? paso.ok;
  if (!texto) return null;
  const tono = error ? "text-red-700" : "tipo" in paso && paso.tipo === "trabajando" ? "text-neutral-600" : "text-emerald-700";
  return <p role={error ? "alert" : "status"} className={`text-sm ${tono}`}>{texto}</p>;
}

async function procesarEnServidor(id: string): Promise<{ estado: string; error?: string; conteo?: { cargadas: number } }> {
  const r = await fetch(`/api/cargas/${id}/procesar`, { method: "POST" });
  return r.ok ? r.json() : { estado: "con_errores", error: (await r.json().catch(() => null))?.error ?? `Error ${r.status}` };
}

/** Subida en tres pasos: registrar (servidor) → subir el Excel directo a Storage (navegador) → procesar (servidor). */
export function FormCargar() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [paso, setPaso] = useState<Paso>(null);
  const [nombre, setNombre] = useState<string | null>(null);
  const trabajando = paso?.tipo === "trabajando";

  async function enviar(datos: FormData) {
    const archivo = datos.get("archivo");
    if (!(archivo instanceof File) || !archivo.size) return setPaso({ tipo: "error", texto: "Elige el Excel del mes." });
    if (!/\.xlsx$/i.test(archivo.name)) return setPaso({ tipo: "error", texto: "Solo se aceptan archivos .xlsx." });
    if (archivo.size > MAX_BYTES_CARGA) return setPaso({ tipo: "error", texto: "El archivo pasa de 50 MB: para la exportación completa pide la carga por script." });

    setPaso({ tipo: "trabajando", texto: "Registrando la carga…" });
    const subida = await prepararCargaAccion({ nombre_archivo: archivo.name, bytes: archivo.size });
    if ("error" in subida) return setPaso({ tipo: "error", texto: subida.error });

    setPaso({ tipo: "trabajando", texto: "Subiendo el archivo…" });
    const up = await createClient().storage.from(BUCKET_CARGAS).uploadToSignedUrl(subida.ruta, subida.token, archivo, { contentType: MIME_XLSX });
    if (up.error) {
      router.refresh();
      return setPaso({ tipo: "error", texto: `No se pudo subir el archivo (${up.error.message}). Reintenta desde la lista.` });
    }

    setPaso({ tipo: "trabajando", texto: "Leyendo y validando las filas (puede tardar un par de minutos)…" });
    const r = await procesarEnServidor(subida.id);
    setPaso(r.estado === "validada"
      ? { tipo: "listo", texto: `Validada: ${r.conteo?.cargadas.toLocaleString("es-HN")} filas. Revisa las alertas abajo y publica.` }
      : { tipo: "error", texto: r.error ?? "No se pudo procesar." });
    form.current?.reset();
    router.refresh();
  }

  return (
    <form ref={form} action={enviar} onReset={() => setNombre(null)} className="space-y-2">
      <p id="archivo-ayuda" className="text-sm text-neutral-700">Excel del mes (.xlsx, máx. 50 MB)</p>
      <div className="flex flex-wrap items-center gap-2">
        {/* El selector nativo dice «Choose File» según el idioma del navegador: se esconde y lo reemplaza este botón. */}
        <label className="inline-flex h-8 cursor-pointer items-center border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
          Elegir archivo
          <input name="archivo" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required aria-describedby="archivo-ayuda"
            className="sr-only" onChange={(e) => setNombre(e.target.files?.[0]?.name ?? null)} />
        </label>
        <span className="min-w-0 truncate text-sm text-neutral-600" aria-live="polite">{nombre ?? "Ningún archivo elegido"}</span>
        <Button type="submit" disabled={trabajando || !nombre}>{trabajando ? "Procesando…" : "Subir y validar"}</Button>
      </div>
      {trabajando && <p className="text-xs text-neutral-500">No cierres esta página mientras se procesa.</p>}
      <Aviso paso={paso} />
    </form>
  );
}

export function Reintentar({ id }: { id: string }) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant="outline" size="default" disabled={paso?.tipo === "trabajando"} onClick={async () => {
        setPaso({ tipo: "trabajando", texto: "Procesando…" });
        const r = await procesarEnServidor(id);
        setPaso(r.estado === "validada" ? null : { tipo: "error", texto: r.error ?? "No se pudo procesar." });
        router.refresh();
      }}>{paso?.tipo === "trabajando" ? "Procesando…" : "Reintentar"}</Button>
      <Aviso paso={paso?.tipo === "error" ? paso : null} />
    </span>
  );
}

export function Descartar({ id }: { id: string }) {
  const [estado, accion, enviando] = useActionState(descartarCarga, null);
  return (
    <form action={accion} className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => { if (!confirm("¿Descartar esta carga? Se borran sus filas y el archivo.")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="default" disabled={enviando}>Descartar</Button>
      {estado?.error && <Aviso paso={estado} />}
    </form>
  );
}

/**
 * Paso 1 de 2 (V1-07): aprobar la carga tal como está. Quien aprueba declara si el último mes está completo y, si hay
 * alertas «Revisar», escribe por qué se aceptan. Si la carga cambia después (homologación, otra versión publicada), la
 * aprobación deja de valer y este formulario vuelve a aparecer.
 */
export function FormAprobar({ id, mesCompletoSugerido, ultimoMes, revisar, bloqueo }: {
  id: string; mesCompletoSugerido: boolean; ultimoMes: string; revisar: number; bloqueo: string | null;
}) {
  const [estado, accion, enviando] = useActionState(aprobarCarga, null);
  return (
    <form action={accion} className="space-y-3 border-t border-neutral-200 pt-4">
      <input type="hidden" name="id" value={id} />
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">1. Aprobar la carga</h3>
        <p className="max-w-prose text-sm text-neutral-700">
          Aprobar deja constancia de que las cifras de este archivo están revisadas. Todavía no cambia nada para el equipo: eso pasa al publicar.
        </p>
      </div>
      <label className="flex max-w-prose items-start gap-2 text-sm">
        <input type="checkbox" name="mesCompleto" defaultChecked={mesCompletoSugerido} className="mt-1 size-4" />
        <span>{ultimoMes} está completo (mes cerrado). Si no, se marca como parcial y las comparaciones lo advierten.</span>
      </label>
      {revisar > 0 && (
        <div className="max-w-prose space-y-1">
          <label htmlFor={`motivo-${id}`} className="text-sm font-medium">
            Por qué se acepta{revisar === 1 ? " la alerta «Revisar»" : `n las ${revisar} alertas «Revisar»`}
          </label>
          <Textarea id={`motivo-${id}`} name="motivo" rows={2} required minLength={10} maxLength={500}
            placeholder="P. ej. «Octubre se reexportó con las notas de crédito; Ventas confirmó el cambio en Detalle»" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={enviando || !!bloqueo} aria-describedby={bloqueo ? `bloqueo-${id}` : undefined}>
          {enviando ? "Aprobando…" : "Aprobar la carga"}
        </Button>
        {bloqueo && <p id={`bloqueo-${id}`} className="max-w-prose text-sm text-red-700">No se puede aprobar: {bloqueo}</p>}
        <Aviso paso={estado} />
      </div>
    </form>
  );
}

/** Quitar una aprobación vigente (con motivo), p. ej. si se aprobó por error. */
export function AnularAprobacion({ id }: { id: string }) {
  const [estado, accion, enviando] = useActionState(anularAprobacionCarga, null);
  const [abierto, setAbierto] = useState(false);
  if (!abierto) return <Button variant="ghost" onClick={() => setAbierto(true)}>Quitar la aprobación</Button>;
  return (
    <form action={accion} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="motivo" required minLength={5} maxLength={300} placeholder="Motivo" aria-label="Motivo para quitar la aprobación" className="h-8 w-64" />
      <Button type="submit" variant="outline" disabled={enviando}>Quitar</Button>
      <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      <Aviso paso={estado} />
    </form>
  );
}

/**
 * Paso 2 de 2: publicar la carga aprobada. Dice qué va a cambiar (versión, meses que reemplaza y agrega); la base vuelve
 * a comprobar que la aprobación sigue al día.
 */
export function FormPublicar({ id, version, reemplaza, agrega, bloqueo }: {
  id: string; version: number; reemplaza: string | null; agrega: string | null; bloqueo: string | null;
}) {
  const [estado, accion, enviando] = useActionState(publicarCarga, null);
  const cambios = [reemplaza && `reemplaza ${reemplaza}`, agrega && `agrega ${agrega}`].filter(Boolean).join(" y ");
  return (
    <form action={accion} className="space-y-3 border-t border-neutral-200 pt-4">
      <input type="hidden" name="id" value={id} />
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">2. Publicar como v{version}</h3>
        <p className="max-w-prose text-sm text-neutral-700">
          Al publicar, v{version} {cambios || "queda como versión vigente"}. El dashboard, el resumen y el asistente cambian al instante para todo el
          equipo; la versión anterior queda en el historial y se puede volver a ella retirando esta.
        </p>
      </div>
      <Textarea name="notas" rows={2} maxLength={500} aria-label="Notas de la versión" placeholder="Notas de la versión (opcional): qué trae, quién exportó, observaciones…" />
      <label className="flex max-w-prose items-start gap-2 text-sm">
        <input type="checkbox" name="correo" className="mt-1 size-4" />
        <span>Enviar el resumen por correo a cada persona con acceso activo (el del último mes cerrado de v{version}).</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" className="px-4" disabled={enviando || !!bloqueo} aria-describedby={bloqueo ? `bloqueo-pub-${id}` : undefined}>
          {enviando ? "Publicando…" : `Publicar v${version}`}
        </Button>
        {bloqueo && <p id={`bloqueo-pub-${id}`} className="max-w-prose text-sm text-red-700">No se puede publicar: {bloqueo}</p>}
        <Aviso paso={estado} />
      </div>
    </form>
  );
}

export function FormRetirar({ version }: { version: number }) {
  const [estado, accion, enviando] = useActionState(retirarVersion, null);
  const [abierto, setAbierto] = useState(false);
  if (!abierto) return <Button variant="outline" size="default" onClick={() => setAbierto(true)}>Retirar</Button>;
  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="version" value={version} />
      <Input name="motivo" required minLength={5} maxLength={300} placeholder="Motivo del retiro" className="h-8" />
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="default" disabled={enviando}>Retirar v{version}</Button>
        <Button type="button" variant="ghost" size="default" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
      <Aviso paso={estado} />
    </form>
  );
}

export function FormConciliar({ version }: { version: number }) {
  const [estado, accion, enviando] = useActionState(conciliarVersion, null);
  const [abierto, setAbierto] = useState(false);
  if (!abierto) return <Button variant="outline" size="default" onClick={() => setAbierto(true)}>Marcar conciliada con BI</Button>;
  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="version" value={version} />
      <Textarea name="nota" required minLength={10} maxLength={500} rows={2} placeholder="Reporte de BI usado y qué coincidió (p. ej. «Reporte BI sep-2026: venta neta y kg por canal iguales al centavo»)" />
      <div className="flex gap-2">
        <Button type="submit" size="default" disabled={enviando}>Confirmar conciliación</Button>
        <Button type="button" variant="ghost" size="default" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
      <Aviso paso={estado} />
    </form>
  );
}
