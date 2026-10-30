"use client";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BUCKET, MAX_BYTES } from "@/lib/conocimiento/tipos";
import { createClient } from "@/lib/supabase/client";
import { cambiarVigenciaDocumento, prepararDocumento, procesarDocumentoSubido } from "./acciones";

type Paso = { tipo: "listo" | "error" | "trabajando"; texto: string } | null;

/** Subida en tres pasos: registrar (servidor) → subir el PDF directo a Storage (navegador) → procesar (servidor). */
export function FormSubir() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [paso, setPaso] = useState<Paso>(null);
  const trabajando = paso?.tipo === "trabajando";

  async function enviar(datos: FormData) {
    const archivo = datos.get("archivo");
    if (!(archivo instanceof File) || !archivo.size) return setPaso({ tipo: "error", texto: "Elige un PDF." });
    if (archivo.type !== "application/pdf" && !/\.pdf$/i.test(archivo.name)) return setPaso({ tipo: "error", texto: "Solo se aceptan PDF." });
    if (archivo.size > MAX_BYTES) return setPaso({ tipo: "error", texto: "El archivo pasa de 20 MB." });
    const texto = (k: string) => String(datos.get(k) ?? "").trim() || null;

    setPaso({ tipo: "trabajando", texto: "Registrando el documento…" });
    const subida = await prepararDocumento({
      titulo: texto("titulo") ?? "", fuente: texto("fuente") ?? "", fecha_documento: texto("fecha"), descripcion: texto("descripcion"),
      audiencia: datos.get("audiencia"), nombre_archivo: archivo.name, bytes: archivo.size,
    });
    if ("error" in subida) return setPaso({ tipo: "error", texto: subida.error });

    setPaso({ tipo: "trabajando", texto: "Subiendo el PDF…" });
    const up = await createClient().storage.from(BUCKET).uploadToSignedUrl(subida.ruta, subida.token, archivo, { contentType: "application/pdf" });
    if (up.error) return setPaso({ tipo: "error", texto: `No se pudo subir el archivo (${up.error.message}). Reintenta desde la tabla.` });

    setPaso({ tipo: "trabajando", texto: "Leyendo y preparando el texto…" });
    const r = await procesarDocumentoSubido(subida.id);
    if (r.estado === "error") setPaso({ tipo: "error", texto: r.error });
    else {
      setPaso({ tipo: "listo", texto: `Listo: ${r.fragmentos} fragmentos${r.conEmbeddings ? " con búsqueda semántica" : " (búsqueda por texto; la semántica se completa cuando haya llave de OpenRouter)"}.` });
      form.current?.reset();
    }
    router.refresh();
  }

  return (
    <form ref={form} action={enviar} className="grid gap-3 md:grid-cols-2">
      <Campo etiqueta="Título"><Input name="titulo" required minLength={3} maxLength={200} className="h-9" /></Campo>
      <Campo etiqueta="Fuente (quién lo produjo)"><Input name="fuente" required minLength={2} maxLength={120} placeholder="Insights BIA, agencia, proveedor…" className="h-9" /></Campo>
      <Campo etiqueta="Fecha del documento"><Input name="fecha" type="date" className="h-9" /></Campo>
      <Campo etiqueta="Quién lo puede consultar">
        <select name="audiencia" defaultValue="estandar" className="block h-9 w-full border border-input bg-background px-2 text-sm">
          <option value="estandar">Todos (Estándar y Plus)</option>
          <option value="plus">Solo Plus</option>
        </select>
      </Campo>
      <Campo etiqueta="Descripción (opcional)" ancho><Textarea name="descripcion" maxLength={1000} rows={2} /></Campo>
      <Campo etiqueta="Archivo PDF (máx. 20 MB, con texto seleccionable)" ancho>
        <input name="archivo" type="file" accept="application/pdf,.pdf" required className="block w-full text-sm" />
      </Campo>
      <label className="flex items-start gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="autorizado" required className="mt-1" />
        <span>Confirmo que el documento está autorizado para consulta interna y para que el asistente cite extractos como contexto, lo que incluye enviarlos al modelo de IA.</span>
      </label>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" size="lg" disabled={trabajando}>{trabajando ? "Procesando…" : "Subir y procesar"}</Button>
        {paso && (
          <p role={paso.tipo === "error" ? "alert" : "status"} className={`text-sm ${paso.tipo === "error" ? "text-red-700" : paso.tipo === "listo" ? "text-emerald-700" : "text-neutral-600"}`}>
            {paso.texto}
          </p>
        )}
      </div>
    </form>
  );
}

function Campo({ etiqueta, ancho, children }: { etiqueta: string; ancho?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block space-y-1 text-sm ${ancho ? "md:col-span-2" : ""}`}>
      <span className="text-neutral-700">{etiqueta}</span>
      {children}
    </label>
  );
}

export function Vigencia({ id, vigente, children }: { id: string; vigente: boolean; children: React.ReactNode }) {
  const [estado, accion, enviando] = useActionState(cambiarVigenciaDocumento, null);
  return (
    <form action={accion} className="inline-flex flex-col items-start">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="vigente" value={vigente ? "si" : "no"} />
      <Button type="submit" variant="outline" size="xs" disabled={enviando}>{children}</Button>
      {estado?.error && <span role="alert" className="mt-1 max-w-48 text-xs text-red-700">{estado.error}</span>}
    </form>
  );
}

export function Reintentar({ id }: { id: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <span className="inline-flex flex-col items-start">
      <Button variant="outline" size="xs" disabled={enviando} onClick={async () => {
        setEnviando(true);
        const r = await procesarDocumentoSubido(id);
        setEnviando(false);
        setMsg(r.estado === "error" ? r.error : null);
        router.refresh();
      }}>{enviando ? "Procesando…" : "Reintentar"}</Button>
      {msg && <span role="alert" className="mt-1 max-w-48 text-xs text-red-700">{msg}</span>}
    </span>
  );
}
