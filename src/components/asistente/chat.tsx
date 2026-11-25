"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CanalChart } from "@/components/dashboard/canal-chart";
import { SerieChart } from "@/components/dashboard/serie-chart";
import {
  ACEPTA_ADJUNTO, BUCKET_ADJUNTOS, FORMATOS_ADJUNTO, MAX_ADJUNTOS, MAX_BYTES_ADJUNTO, MAX_BYTES_IMAGEN, tipoDeAdjunto, unidadAdjunto,
  type AdjuntoResumen, type CitaAdjunto,
} from "@/lib/asistente/adjuntos";
import type { ConversacionResumen, TurnoGuardado, Valoracion } from "@/lib/asistente/conversaciones";
import { createClient } from "@/lib/supabase/client";
import type { Respuesta, Visual } from "@/lib/asistente/tipos";
import { TIPOS, type Cita } from "@/lib/conocimiento/tipos";
import { fechaCorta, lempiras, mesNombre, capital } from "@/lib/format";
import {
  Destello, FlechaArriba, IconoAlerta, IconoCaja, IconoCerrar, IconoClip, IconoCodigo, IconoDocumento, IconoEscudo, IconoGrafico, IconoMapa,
  IconoMas, IconoPersonas, IconoTabla, IconoTendencia,
} from "./iconos";
import { AccionesRespuesta } from "./acciones-respuesta";
import { IconoConversaciones, PanelConversaciones } from "./conversaciones";
import { aFilas, TablaDatos, type Datos } from "./tabla-datos";

/** `id`: el turno en la bitácora (para valorarlo o agregarlo al informe, G9). */
type Intercambio = { id?: number; pregunta: string; respuesta?: Respuesta; error?: string; valoracion?: Valoracion | null; enInforme?: boolean };

export type Sugerencia = { categoria: string; texto: string; icono: keyof typeof ICONOS };
const ICONOS = { tendencia: IconoTendencia, personas: IconoPersonas, caja: IconoCaja, mapa: IconoMapa } as const;
const TINTES = ["bg-indigo-50 text-indigo-600", "bg-rose-50 text-rose-600", "bg-sky-50 text-sky-600", "bg-amber-50 text-amber-600"];

/** A partir de cuántas preguntas se sugiere empezar otra conversación (el modelo solo ve los últimos turnos). */
const PREGUNTAS_SUGERIR_NUEVA = 20;

/** Conversación abierta: su contexto (query string del dashboard con el que empezó) y ese contexto en palabras. */
type Activa = { id: string; titulo: string; contexto: string; contextoTxt: string };
export type ConversacionInicial = { conversacion: ConversacionResumen; contextoTxt: string; turnos: TurnoGuardado[]; adjuntos?: AdjuntoResumen[] };

/** Un adjunto en pantalla: el del servidor o, mientras se registra, uno provisional con id local. */
type AdjuntoVista = AdjuntoResumen & { local?: boolean };

type Props = {
  nombre: string;
  /** Query string del dashboard: las conversaciones nuevas heredan periodo, comparación y filtros. */
  contexto: string;
  /** Periodo y filtros en palabras, para el chip de contexto. */
  contextoTxt: string;
  version: number;
  inicial?: string;
  sugerencias: Sugerencia[];
  conModelo: boolean;
  /** Últimas conversaciones del usuario (precargadas en el servidor). */
  conversaciones: ConversacionResumen[];
  /** Conversación del enlace (?c=id), si existe y es del usuario. */
  abierta: ConversacionInicial | null;
  /** El enlace traía ?c= pero la conversación no existe, es de otro o está archivada: se limpia la URL. */
  descartada?: boolean;
};

const aIntercambios = (turnos: TurnoGuardado[]): Intercambio[] =>
  turnos.map(({ id, pregunta, respuesta, error, valoracion, enInforme }) => ({ id, pregunta, respuesta, error, valoracion, enInforme }));

/**
 * Enlace directo a la conversación (?c=id), conservando periodo, filtros y `sobre`. Con history.replaceState
 * (integrado al router de Next) en vez de router.replace: no vuelve a pedir la página al servidor en cada pregunta.
 */
function fijarUrl(id: string | null, quitarSobre = false) {
  const q = new URLSearchParams(window.location.search);
  if (id) q.set("c", id);
  else q.delete("c");
  if (quitarSobre) q.delete("sobre");
  const qs = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
}

export function Chat({ nombre, contexto, contextoTxt, version, inicial, sugerencias, conModelo, conversaciones, abierta, descartada }: Props) {
  const [lista, setLista] = useState(conversaciones);
  const [activa, setActiva] = useState<Activa | null>(abierta && {
    id: abierta.conversacion.id, titulo: abierta.conversacion.titulo, contexto: abierta.conversacion.contexto, contextoTxt: abierta.contextoTxt,
  });
  const [turnos, setTurnos] = useState<Intercambio[]>(() => aIntercambios(abierta?.turnos ?? []));
  const [preguntas, setPreguntas] = useState(abierta?.conversacion.preguntas ?? 0);
  const [adjuntos, setAdjuntos] = useState<AdjuntoVista[]>(abierta?.adjuntos ?? []);
  const [avisoAdjunto, setAvisoAdjunto] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const ultimo = useRef<HTMLDivElement>(null);
  const enviado = useRef(false);
  /** Solo la última apertura pedida pinta su resultado (clics rápidos entre conversaciones). */
  const apertura = useRef(0);

  const ponerEnLista = (c: ConversacionResumen) =>
    setLista((l) => [c, ...l.filter((x) => x.id !== c.id)].sort((a, b) => b.actualizada_en.localeCompare(a.actualizada_en)));

  async function preguntar(pregunta: string) {
    pregunta = pregunta.trim();
    if (pregunta.length < 2 || enviando || cargando || subiendo) return false;
    const actual = activa;
    setTurnos((ts) => [...ts, { pregunta }]);
    setEnviando(true);
    try {
      // En una conversación abierta el servidor usa su contexto, historial y memoria: el cliente solo manda el id.
      const res = await fetch("/api/asistente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actual ? { pregunta, conversacionId: actual.id } : { pregunta, contexto }),
      });
      const json = await res.json();
      const { conversacionId, preguntas: n, conversacion, turnoId, ...resto } = json as {
        conversacionId?: string; preguntas?: number; conversacion?: ConversacionResumen; turnoId?: number | null; error?: string;
      };
      if (conversacion) ponerEnLista(conversacion);
      // Una conversación que empezó con un adjunto recibe su título con la primera pregunta.
      if (conversacion && actual) setActiva((a) => (a?.id === conversacion.id ? { ...a, titulo: conversacion.titulo } : a));
      if (typeof n === "number") setPreguntas(n);
      if (conversacionId && !actual) {
        setActiva({ id: conversacionId, titulo: conversacion?.titulo ?? pregunta, contexto, contextoTxt });
        fijarUrl(conversacionId);
      }
      const r: Intercambio = res.ok
        ? { id: turnoId ?? undefined, pregunta, respuesta: resto as unknown as Respuesta, valoracion: null, enInforme: false }
        : { pregunta, error: resto.error ?? `Error ${res.status}` };
      setTurnos((ts) => [...ts.slice(0, -1), r]);
    } catch {
      setTurnos((ts) => [...ts.slice(0, -1), { pregunta, error: "No se pudo contactar al servidor." }]);
    } finally {
      setEnviando(false);
    }
    return true;
  }

  const subiendo = adjuntos.some((a) => a.estado === "subiendo" || a.estado === "procesando");

  /**
   * Adjunta un archivo o foto a la conversación (si no hay una abierta, el servidor la crea): registrar → subir
   * directo a Storage → leer. La pregunta se puede escribir mientras tanto; se envía cuando el adjunto está listo.
   */
  async function adjuntar(archivo: File) {
    setAvisoAdjunto(null);
    const t = tipoDeAdjunto(archivo.name);
    if (!t) return setAvisoAdjunto(`Solo se aceptan archivos ${FORMATOS_ADJUNTO}.`);
    if (!archivo.size) return setAvisoAdjunto("El archivo está vacío.");
    if (archivo.size > MAX_BYTES_ADJUNTO) return setAvisoAdjunto("El archivo pasa de 10 MB.");
    if (t.tipo === "imagen" && archivo.size > MAX_BYTES_IMAGEN) return setAvisoAdjunto("La foto pasa de 5 MB. Súbela con menos resolución.");
    if (adjuntos.length >= MAX_ADJUNTOS) return setAvisoAdjunto(`Una conversación admite hasta ${MAX_ADJUNTOS} adjuntos. Quita alguno o empieza otra conversación.`);
    if (enviando || cargando || subiendo) return;

    const local = `local-${Date.now()}`;
    const poner = (a: AdjuntoVista) => setAdjuntos((l) => l.map((x) => (x.id === local || x.id === a.id ? a : x)));
    const fallar = (id: string, error: string) => setAdjuntos((l) => l.map((x) => (x.id === id ? { ...x, estado: "error", error } : x)));
    setAdjuntos((l) => [...l, { id: local, nombre: archivo.name, tipo: t.tipo, estado: "subiendo", error: null, bytes: archivo.size, paginas: null, modo: null, local: true }]);
    const pedido = apertura.current;
    try {
      const res = await fetch("/api/asistente/adjuntos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: archivo.name, bytes: archivo.size, ...(activa ? { conversacionId: activa.id } : { contexto }) }),
      });
      const json = (await res.json()) as {
        adjunto?: AdjuntoResumen; ruta?: string; token?: string; mime?: string; error?: string;
        conversacion?: ConversacionResumen; contexto?: string; contextoTxt?: string;
      };
      if (pedido !== apertura.current) return; // la persona cambió de conversación mientras tanto
      if (json.conversacion) {
        ponerEnLista(json.conversacion);
        if (!activa) {
          setActiva({ id: json.conversacion.id, titulo: json.conversacion.titulo, contexto: json.contexto ?? contexto, contextoTxt: json.contextoTxt ?? contextoTxt });
          fijarUrl(json.conversacion.id);
        }
      }
      if (!res.ok || !json.adjunto || !json.ruta || !json.token) return fallar(local, json.error ?? "No se pudo adjuntar el archivo.");
      const id = json.adjunto.id;
      poner(json.adjunto);

      const up = await createClient().storage.from(BUCKET_ADJUNTOS).uploadToSignedUrl(json.ruta, json.token, archivo, { contentType: json.mime });
      if (up.error) return fallar(id, "No se pudo subir el archivo. Quítalo e intenta de nuevo.");
      setAdjuntos((l) => l.map((x) => (x.id === id ? { ...x, estado: "procesando" } : x)));

      const proc = await fetch(`/api/asistente/adjuntos/${id}`, { method: "POST" });
      const r = (await proc.json()) as { estado?: "listo" | "error"; error?: string; adjunto?: AdjuntoResumen | null };
      if (r.adjunto) poner(r.adjunto);
      else fallar(id, r.error ?? "No se pudo leer el adjunto.");
    } catch {
      setAdjuntos((l) => l.map((x) => (x.estado === "subiendo" || x.estado === "procesando" ? { ...x, estado: "error", error: "No se pudo contactar al servidor." } : x)));
    }
  }

  async function quitarAdjunto(a: AdjuntoVista) {
    setAvisoAdjunto(null);
    if (!a.local) {
      const res = await fetch(`/api/asistente/adjuntos/${a.id}`, { method: "DELETE" }).catch(() => null);
      if (!res || (!res.ok && res.status !== 404)) return setAvisoAdjunto("No se pudo quitar el adjunto. Intenta de nuevo.");
    }
    setAdjuntos((l) => l.filter((x) => x.id !== a.id));
  }

  function nueva() {
    if (enviando) return;
    apertura.current++;
    setActiva(null);
    setTurnos([]);
    setAdjuntos([]);
    setAvisoAdjunto(null);
    setPreguntas(0);
    setCargando(false);
    setPanelAbierto(false);
    fijarUrl(null, true);
  }

  async function abrir(id: string) {
    setPanelAbierto(false);
    if (enviando || id === activa?.id) return;
    const pedido = ++apertura.current;
    const resumen = lista.find((c) => c.id === id);
    setActiva({ id, titulo: resumen?.titulo ?? "", contexto: resumen?.contexto ?? contexto, contextoTxt: "" });
    setTurnos([]);
    setAdjuntos([]);
    setAvisoAdjunto(null);
    setPreguntas(resumen?.preguntas ?? 0);
    setCargando(true);
    fijarUrl(id);
    try {
      const res = await fetch(`/api/asistente/conversaciones/${id}`);
      if (pedido !== apertura.current) return;
      if (res.status === 404) {
        setLista((l) => l.filter((c) => c.id !== id));
        nueva();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as ConversacionInicial;
      if (pedido !== apertura.current) return;
      setActiva({ id, titulo: json.conversacion.titulo, contexto: json.conversacion.contexto, contextoTxt: json.contextoTxt });
      setTurnos(aIntercambios(json.turnos));
      setAdjuntos(json.adjuntos ?? []);
      setPreguntas(json.conversacion.preguntas);
    } catch {
      if (pedido === apertura.current) setTurnos([{ pregunta: resumen?.titulo ?? "Conversación", error: "No se pudo cargar la conversación." }]);
    } finally {
      if (pedido === apertura.current) setCargando(false);
    }
  }

  async function renombrar(id: string, titulo: string) {
    const res = await fetch(`/api/asistente/conversaciones/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titulo }),
    }).catch(() => null);
    if (!res?.ok) return false;
    const { conversacion } = (await res.json()) as { conversacion: ConversacionResumen };
    setLista((l) => l.map((c) => (c.id === id ? { ...c, titulo: conversacion.titulo } : c)));
    setActiva((a) => (a?.id === id ? { ...a, titulo: conversacion.titulo } : a));
    return true;
  }

  async function archivar(id: string) {
    const res = await fetch(`/api/asistente/conversaciones/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res || (!res.ok && res.status !== 404)) return false;
    setLista((l) => l.filter((c) => c.id !== id));
    if (activa?.id === id) nueva();
    return true;
  }

  // Llegada desde "Preguntar al asistente": se envía la pregunta sugerida una sola vez (solo sin conversación abierta).
  useEffect(() => {
    if (inicial && !abierta && !enviado.current) { enviado.current = true; void preguntar(inicial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicial]);
  // ?c= de una conversación que no se puede abrir: se quita del enlace.
  useEffect(() => { if (descartada) fijarUrl(null); }, [descartada]);
  // Al preguntar y al llegar la respuesta, la pregunta queda arriba: la respuesta se lee desde el principio.
  useEffect(() => { if (turnos.length) ultimo.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [turnos]);
  useEffect(() => {
    if (!panelAbierto) return;
    const cerrar = (e: KeyboardEvent) => { if (e.key === "Escape") setPanelAbierto(false); };
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [panelAbierto]);

  // Mientras carga una conversación todavía no se conoce su contexto en palabras: se muestra el de la página.
  const chip = activa?.contextoTxt
    ? <ChipContexto texto={activa.contextoTxt} contexto={activa.contexto} />
    : <ChipContexto texto={contextoTxt} contexto={contexto} />;
  const pie = (
    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-neutral-500">
      <IconoEscudo className="size-3.5 shrink-0" />
      {conModelo ? "Las cifras salen de consultas a la versión publicada y se verifican antes de mostrarse." : "Sin modelo de IA configurado: responde el análisis automático por reglas."}
      {" "}No se envían datos de clientes a la IA.
      {adjuntos.length > 0 && " Lo que adjuntas sí se envía a la IA: no subas datos personales de clientes."}
    </p>
  );
  const cajaAdjuntos = { texto: borrador, setTexto: setBorrador, adjuntos, subiendo, aviso: avisoAdjunto, onAdjuntar: (f: File) => void adjuntar(f), onQuitar: (a: AdjuntoVista) => void quitarAdjunto(a) };
  const panel = (
    <PanelConversaciones conversaciones={lista} activa={activa?.id ?? null} ocupado={enviando}
      onNueva={nueva} onAbrir={(id) => void abrir(id)} onRenombrar={renombrar} onArchivar={archivar} />
  );
  const botonPanel = (
    <button type="button" onClick={() => setPanelAbierto(true)} aria-label="Ver conversaciones" aria-expanded={panelAbierto}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 lg:hidden">
      <IconoConversaciones className="size-3.5" /> Conversaciones
    </button>
  );

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.25rem)] overflow-hidden md:-m-6">
      <div className="hidden h-full shrink-0 lg:block">{panel}</div>
      {panelAbierto && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Conversaciones">
          <div className="absolute inset-0 bg-neutral-900/30" onClick={() => setPanelAbierto(false)} />
          <div className="absolute inset-y-0 left-0 shadow-xl">{panel}</div>
        </div>
      )}

      <div className="relative min-w-0 flex-1 overflow-y-auto">
        {!activa && turnos.length === 0 ? (
          <div className="relative flex min-h-full flex-col items-center justify-start overflow-hidden px-4 pb-12 pt-16 sm:px-6 lg:justify-center lg:py-12">
            <Resplandor />
            <div className="absolute left-4 top-4 z-10">{botonPanel}</div>
            <div className="relative z-10 flex w-full flex-col items-center">
              <h1 className="text-center text-4xl font-semibold tracking-tight text-neutral-900">Hola, {nombre}</h1>
              <p className="mt-2 text-center text-lg text-neutral-600">¿Qué quieres saber de la venta?</p>
              <div className="mt-8 w-full max-w-3xl">
                <Caja grande onPreguntar={preguntar} enviando={enviando} chip={chip} {...cajaAdjuntos} />
              </div>
              <div className="mt-6 grid w-full max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {sugerencias.map((s, i) => {
                  const Icono = ICONOS[s.icono];
                  return (
                    <button key={s.texto} type="button" onClick={() => void preguntar(s.texto)}
                      className="group flex min-h-36 flex-col justify-between rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md">
                      <span>
                        <span className="block text-xs text-neutral-500">{s.categoria}</span>
                        <span className="mt-1 block text-sm font-medium leading-snug text-neutral-900">{s.texto}</span>
                      </span>
                      <span className={`mt-4 grid size-10 place-items-center rounded-lg ${TINTES[i % TINTES.length]}`}><Icono className="size-5" /></span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-8">{pie}</div>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full max-w-4xl flex-col px-6 pt-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
              <div className="flex min-w-0 items-center gap-2">
                {botonPanel}
                <Avatar />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold" title={activa?.titulo}>{activa?.titulo || "Asistente de IA"}</div>
                  <div className="text-xs text-neutral-500">Asistente de IA · versión publicada v{version}</div>
                </div>
              </div>
              <button type="button" onClick={nueva} disabled={enviando}
                className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50">
                <IconoMas className="size-3.5" /> Nueva conversación
              </button>
            </div>

            <div className="flex-1 space-y-8 pb-6">
              {cargando && <Cargando />}
              {turnos.map((t, i) => (
                <div key={i} ref={i === turnos.length - 1 ? ultimo : undefined} className="scroll-mt-6 space-y-4">
                  <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-neutral-200/70 px-4 py-2.5 text-sm text-neutral-900">{t.pregunta}</div>
                  <div className="flex gap-3">
                    <Avatar />
                    <div className="min-w-0 flex-1">
                      {t.respuesta ? <RespuestaVista r={t.respuesta} /> : t.error ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{t.error}</div>
                      ) : <Pensando />}
                      {t.respuesta && t.id !== undefined && (
                        // Guarda su propio estado: cambiar los turnos aquí movería el scroll a la última pregunta.
                        <AccionesRespuesta key={t.id} turnoId={t.id} valoracion={t.valoracion ?? null} enInforme={!!t.enInforme} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="sticky bottom-0 -mx-2 space-y-2 bg-neutral-50 px-2 pb-4 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-gradient-to-t before:from-neutral-50 before:to-transparent">
              {preguntas >= PREGUNTAS_SUGERIR_NUEVA && !enviando && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-2.5 text-xs text-indigo-950">
                  <span className="flex items-center gap-2">
                    <Destello className="size-3.5 shrink-0 text-indigo-500" />
                    Esta conversación ya tiene {preguntas} preguntas. Para un tema nuevo conviene empezar otra: el asistente solo recuerda las últimas.
                  </span>
                  <button type="button" onClick={nueva}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-neutral-900 px-3 py-1 font-medium text-white hover:bg-neutral-700">
                    <IconoMas className="size-3.5" /> Nueva conversación
                  </button>
                </div>
              )}
              <Caja onPreguntar={preguntar} enviando={enviando || cargando} chip={chip} {...cajaAdjuntos} />
              {pie}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Cargando() {
  return (
    <div className="space-y-4" aria-live="polite" aria-busy="true">
      <p className="text-sm text-neutral-500">Cargando la conversación…</p>
      <div className="ml-auto h-9 w-2/5 animate-pulse rounded-2xl bg-neutral-200/70" />
      <div className="space-y-2">
        <div className="h-3 w-11/12 animate-pulse rounded bg-neutral-200" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-200" />
        <div className="mt-4 h-40 animate-pulse rounded-xl bg-neutral-100" />
      </div>
    </div>
  );
}

function Resplandor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute left-1/2 top-[38%] h-[420px] w-[900px] max-w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(129,140,248,0.34),transparent)] blur-2xl" />
      <div className="absolute left-[64%] top-[48%] h-[340px] w-[600px] max-w-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(244,114,182,0.26),transparent)] blur-2xl" />
    </div>
  );
}

function Avatar() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-rose-400 text-white shadow-sm">
      <Destello className="size-4" />
    </span>
  );
}

function ChipContexto({ texto, contexto }: { texto: string; contexto: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600">
      <span className="truncate" title={texto}>{texto}</span>
      <Link href={`/?${contexto}`} className="shrink-0 font-medium text-neutral-900 underline-offset-4 hover:underline">Cambiar</Link>
    </span>
  );
}

/** Caja de pregunta: crece con el texto; Enter envía y Shift+Enter baja de línea. */
function Caja({ grande, onPreguntar, enviando, chip, texto, setTexto, adjuntos, subiendo, aviso, onAdjuntar, onQuitar }: {
  grande?: boolean; onPreguntar: (p: string) => Promise<boolean>; enviando: boolean; chip: React.ReactNode;
  /** El borrador vive en el chat: adjuntar un archivo abre la conversación y cambia de caja sin perder lo escrito. */
  texto: string; setTexto: (t: string) => void;
  adjuntos: AdjuntoVista[]; subiendo: boolean; aviso: string | null; onAdjuntar: (f: File) => void; onQuitar: (a: AdjuntoVista) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const ajustar = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  async function enviar() {
    const t = texto;
    if (t.trim().length < 2 || enviando || subiendo) return;
    setTexto("");
    requestAnimationFrame(ajustar);
    await onPreguntar(t);
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void enviar(); }}
      className={`rounded-2xl border border-neutral-200 bg-white shadow-[0_10px_40px_-12px_rgba(15,23,42,0.18)] transition focus-within:border-neutral-300 ${grande ? "p-4" : "p-3"}`}>
      {adjuntos.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Adjuntos de esta conversación">
          {adjuntos.map((a) => <ChipAdjunto key={a.id} a={a} onQuitar={() => onQuitar(a)} />)}
        </ul>
      )}
      {aviso && <p role="alert" className="mb-2 px-1 text-xs text-red-700">{aviso}</p>}
      <textarea ref={ref} value={texto} maxLength={500} rows={grande ? 2 : 1} aria-label="Pregunta"
        onChange={(e) => { setTexto(e.target.value); ajustar(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
        placeholder={grande ? "Pregunta sobre venta, volumen, precio, clientes o facturas…" : "Haz otra pregunta…"}
        className={`w-full resize-none bg-transparent px-1 leading-relaxed outline-none placeholder:text-neutral-400 ${grande ? "text-base" : "text-sm"}`} />
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <input ref={archivo} type="file" accept={ACEPTA_ADJUNTO} className="hidden" tabIndex={-1} aria-hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onAdjuntar(f); }} />
          <button type="button" onClick={() => archivo.current?.click()} disabled={enviando || subiendo}
            aria-label="Adjuntar un archivo o una foto" title={`Adjuntar: ${FORMATOS_ADJUNTO}. Hasta 10 MB (fotos, 5 MB).`}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-neutral-200 text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40">
            <IconoClip />
          </button>
          {chip}
        </div>
        <button type="submit" aria-label="Preguntar" disabled={enviando || subiendo || texto.trim().length < 2}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-neutral-900 text-white transition hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-400">
          <FlechaArriba />
        </button>
      </div>
    </form>
  );
}

const ESTADO_ADJUNTO: Record<AdjuntoResumen["estado"], string> = { subiendo: "Subiendo…", procesando: "Leyendo…", listo: "", error: "No se pudo usar" };

/** Un adjunto de la conversación junto a la caja: nombre, estado y quitar. */
function ChipAdjunto({ a, onQuitar }: { a: AdjuntoVista; onQuitar: () => void }) {
  const trabajando = a.estado === "subiendo" || a.estado === "procesando";
  const detalle = a.estado === "error" ? a.error ?? ESTADO_ADJUNTO.error
    : a.estado === "listo" ? (a.modo === "directo" ? "El asistente lo lee completo" : "El asistente busca en él lo que necesita")
    : ESTADO_ADJUNTO[a.estado];
  return (
    <li title={`${a.nombre} — ${detalle}`}
      className={`flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1 text-xs ${a.estado === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-neutral-200 bg-neutral-50 text-neutral-700"}`}>
      {trabajando
        ? <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" aria-hidden />
        : <IconoDocumento className="size-3.5 shrink-0" />}
      <span className="max-w-48 truncate font-medium">{a.nombre}</span>
      {(trabajando || a.estado === "error") && <span className="max-w-64 truncate" role={a.estado === "error" ? "alert" : "status"}>{detalle}</span>}
      <button type="button" onClick={onQuitar} disabled={trabajando} aria-label={`Quitar ${a.nombre}`}
        className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-neutral-200 disabled:opacity-40">
        <IconoCerrar className="size-3" />
      </button>
    </li>
  );
}

function Pensando() {
  return (
    <div className="space-y-3 pt-1" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-neutral-500">
        <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-indigo-400 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-indigo-500" /></span>
        Consultando la versión publicada y verificando cifras…
      </p>
      <div className="space-y-2">
        <div className="h-3 w-11/12 animate-pulse rounded bg-neutral-200" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-200" />
        <div className="mt-4 h-40 animate-pulse rounded-xl bg-neutral-100" />
      </div>
    </div>
  );
}

/** Una respuesta completa (también la usa la bitácora del admin para ver lo que vio el usuario). */
export function RespuestaVista({ r }: { r: Respuesta }) {
  const [panel, setPanel] = useState<"consulta" | "evidencia" | null>(null);
  if (r.estado === "fuera_de_alcance") {
    return (
      <div className="space-y-3">
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
          <IconoAlerta className="mt-0.5 size-4 shrink-0" />
          <p>{r.texto}</p>
        </div>
        <ContextoDocumentos citas={r.contexto ?? []} />
        <ContextoAdjuntos citas={r.adjuntos ?? []} />
      </div>
    );
  }
  const advertencias = r.evidencia.advertencias;
  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-relaxed text-neutral-900 tabular-nums">{r.texto}</p>

      {r.visuales.map((v, i) => <Resultado key={i} v={v} />)}

      {(r.hechos.length > 0 || r.hipotesis.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <Lista titulo="Hechos comprobados" items={r.hechos} punto="bg-emerald-500" />
          <Lista titulo="Hipótesis a validar" items={r.hipotesis} punto="bg-amber-500" vacio="Sin hipótesis: la pregunta se responde con los datos." />
        </div>
      )}

      <ContextoDocumentos citas={r.contexto ?? []} />
      <ContextoAdjuntos citas={r.adjuntos ?? []} />

      {advertencias.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-800">
          {advertencias.map((a, i) => <li key={`${i}-${a}`} className="flex gap-1.5"><IconoAlerta className="mt-px size-3.5 shrink-0" />{a}</li>)}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3 print:hidden">
        {r.consultas.length > 0 && (
          <Pastilla activa={panel === "consulta"} onClick={() => setPanel(panel === "consulta" ? null : "consulta")}>
            <IconoCodigo className="size-3.5" /> Ver consulta y datos
          </Pastilla>
        )}
        <Pastilla activa={panel === "evidencia"} onClick={() => setPanel(panel === "evidencia" ? null : "evidencia")}>
          <IconoEscudo className="size-3.5" /> Evidencia
        </Pastilla>
        <span className="ml-auto text-xs text-neutral-500">
          v{r.evidencia.version} · corte {r.evidencia.fecha_corte} · {r.modo === "modelo" ? "redactó la IA, cifras verificadas" : "análisis automático por reglas"}
        </span>
      </div>

      {panel === "consulta" && <Consultas r={r} />}
      {panel === "evidencia" && <Evidencia r={r} />}
    </div>
  );
}

function Pastilla({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activa}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${activa ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100"}`}>
      {children}
    </button>
  );
}

/** Un resultado: gráfico o tabla con los mismos datos, como en un explorador de datos. */
function Resultado({ v }: { v: Visual }) {
  const [vista, setVista] = useState<"grafico" | "tabla">(v.tipo === "tabla" ? "tabla" : "grafico");
  const datos = datosDeVisual(v);
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2.5">
        <span className="text-sm font-medium text-neutral-900">{v.titulo}</span>
        {v.tipo !== "tabla" && (
          <div className="flex rounded-lg bg-neutral-100 p-0.5 text-xs">
            {(["grafico", "tabla"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setVista(k)} aria-pressed={vista === k}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${vista === k ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>
                {k === "grafico" ? <IconoGrafico className="size-3.5" /> : <IconoTabla className="size-3.5" />}
                {k === "grafico" ? "Gráfico" : "Tabla"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-4">
        {vista === "tabla" ? <TablaDatos datos={datos} /> : v.tipo === "variacion" ? (
          <CanalChart filas={v.filas} anchoEtiqueta={180} />
        ) : v.tipo === "serie" ? (
          <SerieChart datos={v.puntos} anio={v.anio} mesSeleccionado={v.mesSeleccionado} />
        ) : null}
      </div>
    </div>
  );
}

const conSigno = (v: number) => (v > 0 ? `+${lempiras(v)}` : lempiras(v));
const varPct = (a: number | null, b: number | null) => {
  if (a === null || b === null || b === 0) return "—";
  const p = (a / b - 1) * 100;
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toLocaleString("es-HN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
};

function datosDeVisual(v: Visual): Datos {
  if (v.tipo === "tabla") return { columnas: v.columnas, filas: v.filas };
  if (v.tipo === "variacion") {
    return {
      columnas: ["Valor", "Actual", "Comparado", "Variación", "Var. %"],
      filas: v.filas.map((f) => [f.valor, lempiras(f.actual), lempiras(f.anterior), conSigno(f.variacion), varPct(f.actual, f.anterior)]),
    };
  }
  return {
    columnas: ["Mes", String(v.anio), String(v.anio - 1), "Var. %"],
    filas: v.puntos.map((p) => [
      `${capital(mesNombre(p.mes))}${p.parcial ? " (parcial)" : ""}`,
      p.actual === null ? null : lempiras(p.actual),
      p.anterior === null ? null : lempiras(p.anterior),
      varPct(p.actual, p.anterior),
    ]),
  };
}

function Lista({ titulo, items, punto, vacio }: { titulo: string; items: string[]; punto: string; vacio?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-700">
        <span className={`size-1.5 rounded-full ${punto}`} />{titulo}
      </div>
      {items.length ? (
        // Dos consultas iguales dan el mismo hecho dos veces: se muestra una vez.
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-neutral-700 tabular-nums">{[...new Set(items)].map((h) => <li key={h}>{h}</li>)}</ul>
      ) : <p className="text-[13px] text-neutral-400">{vacio}</p>}
    </div>
  );
}

/** Lo que se usó de los adjuntos de la persona: aparte de los hechos del cubo y de los documentos autorizados. */
function ContextoAdjuntos({ citas }: { citas: CitaAdjunto[] }) {
  if (!citas.length) return null;
  return (
    <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-xs">
      <div>
        <div className="flex items-center gap-1.5 font-semibold text-violet-900"><IconoClip className="size-3.5" /> De tus adjuntos</div>
        <p className="mt-0.5 text-violet-900/80">Es lo que tú subiste a esta conversación: no son datos de venta de BIA ni documentos autorizados.</p>
      </div>
      <ol className="space-y-3">
        {citas.map((c) => (
          <li key={c.id} className="space-y-1">
            <div className="font-medium text-neutral-900">
              [{c.id}] {c.nombre}
              {c.pagina !== null && unidadAdjunto(c.tipo) && <span className="font-normal text-neutral-600"> · {unidadAdjunto(c.tipo)} {c.pagina}</span>}
            </div>
            <blockquote className="border-l-2 border-violet-300 pl-2 text-neutral-700">{c.extracto}</blockquote>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Contexto de documentos autorizados (G6): aparte de los hechos, con documento, fuente y página. */
function ContextoDocumentos({ citas }: { citas: Cita[] }) {
  if (!citas.length) return null;
  return (
    <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-xs">
      <div>
        <div className="flex items-center gap-1.5 font-semibold text-sky-900"><IconoDocumento className="size-3.5" /> Contexto de documentos autorizados</div>
        <p className="mt-0.5 text-sky-900/80">No son datos de venta: sirven para entender causas y contexto.</p>
      </div>
      <ol className="space-y-3">
        {citas.map((c) => (
          <li key={c.id} className="space-y-1">
            <div className="font-medium text-neutral-900">
              [{c.id}] {c.titulo}
              <span className="font-normal text-neutral-600"> · {c.fuente}{c.fecha && ` · ${fechaCorta(c.fecha)}`} · {TIPOS[c.tipo ?? "pdf"].abrev} {c.pagina}</span>
            </div>
            <blockquote className="border-l-2 border-sky-300 pl-2 text-neutral-700">{c.extracto}</blockquote>
            {/* Solo un PDF se abre en el navegador en la página citada; los demás formatos se descargan. */}
            <a href={`/api/conocimiento/${c.documentoId}${(c.tipo ?? "pdf") === "pdf" ? `#page=${c.pagina}` : ""}`} target="_blank" rel="noopener" className="text-sky-800 underline-offset-4 hover:underline">
              {(c.tipo ?? "pdf") === "pdf" ? `Abrir PDF en la página ${c.pagina}` : `Descargar el archivo de ${TIPOS[c.tipo ?? "pdf"].nombre} (${TIPOS[c.tipo ?? "pdf"].unidad} ${c.pagina})`}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

const NOMBRE_HERRAMIENTA: Record<string, string> = {
  kpi_periodo: "Indicadores del periodo",
  variacion_por_dimension: "Variación por dimensión",
  top_rutas: "Rutas que explican la variación",
  serie_mensual: "Serie mensual",
  descomposicion: "Descomposición de la venta",
};

function Consultas({ r }: { r: Respuesta }) {
  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
      {r.consultas.map((c) => {
        const datos = aFilas(c.datos);
        return (
          <div key={c.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600">{c.id}</span>
              <span className="font-medium">{NOMBRE_HERRAMIENTA[c.herramienta] ?? c.herramienta}</span>
              <span className="text-xs text-neutral-500">{c.calculo}</span>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-100">{`${c.herramienta}(${JSON.stringify(c.argumentos, null, 2)})`}</pre>
            {datos ? <TablaDatos datos={datos} maxAlto="max-h-72" /> : (
              <pre className="max-h-56 overflow-auto rounded-lg bg-neutral-50 p-2 text-[11px]">{JSON.stringify(c.datos, null, 1)}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Evidencia({ r }: { r: Respuesta }) {
  const e = r.evidencia;
  const filas: [string, string][] = [
    ["Fuente", e.fuente],
    ["Versión", `v${e.version} · corte ${e.fecha_corte} · ${e.conciliada_bi ? "conciliada con BI" : "sin conciliar con BI"}`],
    ["Periodo", e.periodo],
    ["Filtros", e.filtros],
    ...(e.cobertura ? [["Cobertura", e.cobertura] as [string, string]] : []),
    ["Cálculo", e.calculo.join(", ") || "—"],
    ["Redacción", r.modo === "modelo" ? "modelo de IA, cifras verificadas" : "análisis automático por reglas"],
  ];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 text-xs">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
        {filas.map(([k, v]) => <div key={k} className="contents"><dt className="text-neutral-500">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
      </dl>
    </div>
  );
}
