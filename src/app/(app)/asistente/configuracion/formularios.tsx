"use client";
import { useActionState, useMemo, useState } from "react";
import type { ModeloCatalogo } from "@/lib/asistente/config-servidor";
import { guardarModelo, probar, type EstadoConfig, type EstadoPrueba } from "./acciones";

const USD = new Intl.NumberFormat("es-HN", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const precio = (v: number | null) => (v === null ? "—" : v < 0.01 && v > 0 ? "< US$0.01" : USD.format(v).replace("USD", "US$"));
const contexto = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("es-HN", { maximumFractionDigits: 1 })} M` : `${Math.round(n / 1000)} k`);

type Props = {
  usarIa: boolean;
  /** Modelo guardado (null = el por defecto del servidor). */
  modelo: string | null;
  porDefecto: string;
  catalogo: ModeloCatalogo[];
  errorCatalogo?: string;
  conLlave: boolean;
};

export function FormModelo({ usarIa, modelo, porDefecto, catalogo, errorCatalogo, conLlave }: Props) {
  const [estado, accion, enviando] = useActionState<EstadoConfig, FormData>(guardarModelo, null);
  const [ia, setIa] = useState(usarIa);
  const [elegido, setElegido] = useState<string>(modelo ?? "");
  const [busqueda, setBusqueda] = useState("");
  const [proveedor, setProveedor] = useState("");

  const proveedores = useMemo(() => [...new Set(catalogo.map((m) => m.proveedor))].sort(), [catalogo]);
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return catalogo
      .filter((m) => (!proveedor || m.proveedor === proveedor) && (!q || m.id.toLowerCase().includes(q) || m.nombre.toLowerCase().includes(q)))
      // El elegido y el por defecto siempre arriba, para no perderlos al filtrar.
      .sort((a, b) => Number(b.id === elegido) - Number(a.id === elegido) || Number(b.id === porDefecto) - Number(a.id === porDefecto));
  }, [catalogo, busqueda, proveedor, elegido, porDefecto]);
  const cambio = ia !== usarIa || (elegido || null) !== modelo;

  return (
    <form action={accion} className="space-y-5">
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-sm font-semibold">Cómo responde</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Opcion nombre="usarIa" valor="si" activo={ia} onChange={() => setIa(true)} titulo="Con IA"
            texto="Un modelo de lenguaje elige las consultas y redacta. Sus cifras se verifican contra las consultas antes de mostrarse." />
          <Opcion nombre="usarIa" valor="no" activo={!ia} onChange={() => setIa(false)} titulo="Solo análisis automático"
            texto="Sin IA: interpreta la pregunta con reglas y redacta con plantillas. Mismas cifras, texto menos natural, sin costo." />
        </div>
        {!conLlave && <p className="text-xs text-amber-800">El servidor no tiene llave de OpenRouter: aunque elijas «Con IA», responde el análisis automático.</p>}
      </fieldset>

      {/* Sin IA el modelo queda guardado (no se envía vacío): al volver a «Con IA» sigue el mismo. */}
      <fieldset className={`min-w-0 space-y-3 ${ia ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!ia}>
        <legend className="mb-2 text-sm font-semibold">Modelo</legend>
        <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${elegido === "" ? "border-neutral-900 bg-white" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
          <input type="radio" name="modelo" value="" checked={elegido === ""} onChange={() => setElegido("")} className="mt-1" />
          <span>
            <span className="font-medium">El por defecto del servidor</span>
            <span className="block font-mono text-xs text-neutral-500">{porDefecto}</span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar modelo (p. ej. claude, gpt, gemini, deepseek)…"
            className="h-9 min-w-56 flex-1 rounded-md border border-neutral-200 bg-white px-3 text-sm" aria-label="Buscar modelo" />
          <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm" aria-label="Proveedor">
            <option value="">Todos los proveedores</option>
            {proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {errorCatalogo && <p className="text-xs text-red-700">{errorCatalogo}</p>}

        <div className="max-h-96 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-neutral-500">
              <tr className="border-b border-neutral-200">
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 font-medium">Modelo</th>
                <th className="px-3 py-2 text-right font-medium" title="Dólares por millón de tokens">Entrada / M</th>
                <th className="px-3 py-2 text-right font-medium" title="Dólares por millón de tokens">Salida / M</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Contexto</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-500">Ningún modelo coincide.</td></tr>}
              {visibles.map((m) => (
                <tr key={m.id} onClick={() => setElegido(m.id)}
                  className={`cursor-pointer border-b border-neutral-100 last:border-b-0 ${elegido === m.id ? "bg-neutral-100" : "hover:bg-neutral-50"}`}>
                  <td className="px-3 py-2"><input type="radio" name="modelo" value={m.id} checked={elegido === m.id} onChange={() => setElegido(m.id)} aria-label={m.nombre} /></td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {m.nombre}
                      {m.id === modelo && <Etiqueta>en uso</Etiqueta>}
                      {m.id === porDefecto && <Etiqueta>por defecto</Etiqueta>}
                      {m.gratis && <Etiqueta>gratis, con límites</Etiqueta>}
                    </div>
                    <div className="font-mono text-xs text-neutral-500">{m.id}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{precio(m.entrada)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{precio(m.salida)}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-600 sm:table-cell">{contexto(m.contexto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-500">
          Solo aparecen los modelos de OpenRouter que pueden usar herramientas (el asistente las necesita para consultar los datos). Precios en dólares por
          millón de tokens; una pregunta típica usa unos pocos miles. Prueba un modelo abajo antes de cambiarlo.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={enviando || !cambio}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:bg-neutral-300">
          {enviando ? "Guardando…" : "Guardar"}
        </button>
        {estado?.error && <p className="text-sm text-red-700">{estado.error}</p>}
        {estado?.ok && !cambio && <p className="text-sm text-emerald-700">{estado.ok}</p>}
      </div>
    </form>
  );
}

function Opcion({ nombre, valor, activo, onChange, titulo, texto }: { nombre: string; valor: string; activo: boolean; onChange: () => void; titulo: string; texto: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 text-sm ${activo ? "border-neutral-900" : "border-neutral-200 hover:border-neutral-300"}`}>
      <input type="radio" name={nombre} value={valor} checked={activo} onChange={onChange} className="mt-1" />
      <span><span className="font-medium">{titulo}</span><span className="mt-0.5 block text-xs text-neutral-600">{texto}</span></span>
    </label>
  );
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 align-[1px] text-[11px] font-normal text-neutral-600">{children}</span>;
}

const PREGUNTAS = [
  "¿Dónde se concentra la variación del mes?",
  "¿Bajó el número de facturas o el ticket?",
  "¿Qué productos cayeron más en Mayoreo?",
  "¿Cómo viene la venta neta mes a mes este año?",
];

/** Prueba un modelo con una pregunta, sin guardarlo ni dejarlo en la bitácora. */
export function FormPrueba({ catalogo, sugerido }: { catalogo: ModeloCatalogo[]; sugerido: string }) {
  const [estado, accion, enviando] = useActionState<EstadoPrueba, FormData>(probar, null);
  const r = estado?.resultado;
  return (
    <form action={accion} className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <select name="modeloPrueba" defaultValue={sugerido} className="h-9 w-full min-w-0 rounded-md border border-neutral-200 bg-white px-2 text-sm" aria-label="Modelo a probar">
          {catalogo.map((m) => <option key={m.id} value={m.id}>{m.nombre} · {m.id}</option>)}
        </select>
        <input name="pregunta" list="preguntas-prueba" defaultValue={PREGUNTAS[0]} maxLength={500}
          className="h-9 w-full min-w-0 rounded-md border border-neutral-200 bg-white px-3 text-sm" aria-label="Pregunta de prueba" />
        <datalist id="preguntas-prueba">{PREGUNTAS.map((p) => <option key={p} value={p} />)}</datalist>
        <button type="submit" disabled={enviando} className="h-9 rounded-md border border-neutral-900 px-4 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50">
          {enviando ? "Probando…" : "Probar"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">Responde con la versión publicada y el periodo por defecto. No cambia la configuración ni queda en la bitácora; sí gasta tokens.</p>
      {estado?.error && <p className="text-sm text-red-700">{estado.error}</p>}
      {r && (
        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
            <span className="font-mono">{r.modelo}</span>
            <span>{r.segundos.toLocaleString("es-HN", { maximumFractionDigits: 1 })} s</span>
            <span className={r.verificada ? "text-emerald-700" : "text-amber-700"}>
              {r.estado === "fuera_de_alcance" ? "Fuera de alcance (no llama a la IA)" : r.verificada ? "Texto de la IA con cifras verificadas" : "Se usó la redacción automática"}
            </span>
            {r.herramientas.length > 0 && <span>Consultas: {r.herramientas.join(", ")}</span>}
          </div>
          {r.aviso && <p className="text-xs text-amber-800">{r.aviso}</p>}
          <p className="leading-relaxed tabular-nums">{r.texto}</p>
        </div>
      )}
    </form>
  );
}
