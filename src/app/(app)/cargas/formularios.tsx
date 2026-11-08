"use client";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BUCKET_CARGAS, MAX_BYTES_CARGA, MIME_XLSX } from "@/lib/cargas/tipos";
import { createClient } from "@/lib/supabase/client";
import { conciliarVersion, descartarCarga, prepararCargaAccion, publicarCarga, retirarVersion, type Estado } from "./acciones";

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
    <form ref={form} action={enviar} className="flex flex-wrap items-end gap-3">
      <label className="block space-y-1 text-sm">
        <span className="text-neutral-700">Excel del mes (.xlsx, mismo formato del cubo, máx. 50 MB)</span>
        <input name="archivo" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className="block text-sm" />
      </label>
      <Button type="submit" size="lg" disabled={trabajando}>{trabajando ? "Procesando…" : "Subir y validar"}</Button>
      <div className="w-full"><Aviso paso={paso} /></div>
    </form>
  );
}

export function Reintentar({ id }: { id: string }) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant="outline" size="xs" disabled={paso?.tipo === "trabajando"} onClick={async () => {
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
      <Button type="submit" variant="outline" size="xs" disabled={enviando}>Descartar</Button>
      {estado?.error && <Aviso paso={estado} />}
    </form>
  );
}

/** Publicar: notas, si el último mes está completo y, si hay alertas para revisar, la confirmación. */
export function FormPublicar({ id, mesCompletoSugerido, ultimoMes, hayRevisar, bloqueada }: {
  id: string; mesCompletoSugerido: boolean; ultimoMes: string; hayRevisar: boolean; bloqueada: boolean;
}) {
  const [estado, accion, enviando] = useActionState(publicarCarga, null);
  return (
    <form action={accion} className="space-y-2 border-t border-neutral-200 pt-3">
      <input type="hidden" name="id" value={id} />
      <Textarea name="notas" rows={2} maxLength={500} placeholder="Notas de la versión (opcional): qué trae, quién exportó, observaciones…" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="mesCompleto" defaultChecked={mesCompletoSugerido} className="mt-1" />
        <span>{ultimoMes} está completo (mes cerrado). Si no, se marca como parcial y las comparaciones lo advierten.</span>
      </label>
      {hayRevisar && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="revisado" required className="mt-1" />
          <span>Revisé las alertas y las cifras son correctas.</span>
        </label>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="correo" className="mt-1" />
        <span>Enviar el resumen por correo al equipo (personas con acceso activo). Va el resumen del último mes cerrado de la versión nueva.</span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={enviando || bloqueada}>{enviando ? "Publicando…" : "Publicar versión"}</Button>
        <Aviso paso={estado} />
      </div>
    </form>
  );
}

export function FormRetirar({ version }: { version: number }) {
  const [estado, accion, enviando] = useActionState(retirarVersion, null);
  const [abierto, setAbierto] = useState(false);
  if (!abierto) return <Button variant="outline" size="xs" onClick={() => setAbierto(true)}>Retirar</Button>;
  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="version" value={version} />
      <Input name="motivo" required minLength={5} maxLength={300} placeholder="Motivo del retiro" className="h-8" />
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="xs" disabled={enviando}>Retirar v{version}</Button>
        <Button type="button" variant="ghost" size="xs" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
      <Aviso paso={estado} />
    </form>
  );
}

export function FormConciliar({ version }: { version: number }) {
  const [estado, accion, enviando] = useActionState(conciliarVersion, null);
  const [abierto, setAbierto] = useState(false);
  if (!abierto) return <Button variant="outline" size="xs" onClick={() => setAbierto(true)}>Marcar conciliada con BI</Button>;
  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="version" value={version} />
      <Textarea name="nota" required minLength={10} maxLength={500} rows={2} placeholder="Reporte de BI usado y qué coincidió (p. ej. «Reporte BI sep-2026: venta neta y kg por canal iguales al centavo»)" />
      <div className="flex gap-2">
        <Button type="submit" size="xs" disabled={enviando}>Confirmar conciliación</Button>
        <Button type="button" variant="ghost" size="xs" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
      <Aviso paso={estado} />
    </form>
  );
}
