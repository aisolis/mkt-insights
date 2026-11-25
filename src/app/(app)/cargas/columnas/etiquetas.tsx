"use client";
import { ArrowUpIcon, PlusIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizarEncabezado } from "@/lib/cargas/columnas";

/**
 * Lista de nombres como etiquetas: se agregan escribiendo (Enter, coma o pegando varias líneas) y se quitan o
 * reordenan con un clic. Reemplaza a las cajas de «uno por línea».
 *
 * No cambia lo que recibe el servidor: los valores viajan en campos ocultos con los mismos nombres de antes
 * (`campos(valores)`), así que las acciones y sus validaciones siguen iguales. Lo que quedó escrito sin agregar
 * también se envía: es fácil escribir un nombre y pulsar «Guardar» sin pasar por «Agregar».
 */

const igual = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const limpiar = (partes: string[]) => partes.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
/** Parte lo escrito o pegado en nombres de columna: por líneas, comas o punto y coma. */
const partir = (texto: string) => limpiar(texto.split(/[\n,;]/));
/** Un nombre de hoja puede llevar comas («Venta, kilos»): solo se parte por líneas. */
const partirLineas = (texto: string) => limpiar(texto.split("\n"));

/**
 * `clave`: cuándo dos nombres son el mismo. `separar`: cómo se parte lo escrito. `preparar`: ajuste a lo escrito
 * antes de agregarlo o enviarlo (p. ej. la regla «empiezan así» de las hojas).
 */
function useEtiquetas(inicial: string[], max: number, clave: (t: string) => string, separar = partir, preparar = (t: string) => t) {
  const [valores, setValores] = useState(inicial);
  const [base, setBase] = useState(inicial);
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  // Al guardar, el servidor devuelve la lista nueva: la edición arranca otra vez desde ahí.
  if (!igual(base, inicial)) {
    setBase(inicial);
    setValores(inicial);
    setTexto("");
    setAviso(null);
  }

  /** Agrega los nombres que no estén ya (sin importar mayúsculas, tildes ni signos). Devuelve la lista resultante. */
  function sumar(lista: string[], nuevos: string[]): { lista: string[]; aviso: string | null } {
    const claves = new Set(lista.map(clave));
    const salida = [...lista];
    let repetido: string | null = null, sobran = false, largo = false;
    for (const n of nuevos) {
      if (n.length > 100) { largo = true; continue; }
      const k = clave(n);
      if (!k) continue;
      if (claves.has(k)) { repetido = n; continue; }
      if (salida.length >= max) { sobran = true; break; }
      claves.add(k);
      salida.push(n);
    }
    return {
      lista: salida,
      aviso: sobran ? `Caben hasta ${max}.` : largo ? "Un nombre no puede pasar de 100 caracteres." : repetido ? `«${repetido}» ya está en la lista (no importan mayúsculas, tildes ni signos).` : null,
    };
  }

  function agregar(crudo = preparar(texto)) {
    const r = sumar(valores, separar(crudo));
    setValores(r.lista);
    setAviso(r.aviso);
    setTexto("");
  }
  const quitar = (i: number) => { setValores((v) => v.filter((_, j) => j !== i)); setAviso(null); };
  /** Sube un puesto; `alPrincipio` lo lleva al primer lugar. */
  const subir = (i: number, alPrincipio = false) => setValores((v) => {
    const copia = [...v];
    const [x] = copia.splice(i, 1);
    copia.splice(alPrincipio ? 0 : Math.max(0, i - 1), 0, x);
    return copia;
  });
  // Lo que se envía: la lista más lo que quedó escrito sin agregar.
  const paraEnviar = texto.trim() ? sumar(valores, separar(preparar(texto))).lista : valores;
  return { valores, texto, setTexto, aviso, agregar, quitar, subir, paraEnviar, cambiado: !igual(paraEnviar, inicial) };
}

type Estado = ReturnType<typeof useEtiquetas>;

/** Campo para escribir un nombre nuevo, con el botón «Agregar». `sugeridos`: opciones que ofrece el navegador al escribir. */
function Agregar({ id, e, placeholder, etiqueta, sugeridos = [] }: { id: string; e: Estado; placeholder: string; etiqueta: string; sugeridos?: string[] }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="sr-only">{etiqueta}</label>
      <Input id={id} value={e.texto} placeholder={placeholder} maxLength={300} list={sugeridos.length ? `${id}-opciones` : undefined}
        className="h-8 max-w-72 min-w-0 flex-1 text-sm md:text-sm"
        onChange={(ev) => e.setTexto(ev.target.value)}
        onKeyDown={(ev) => {
          // Enter agrega el nombre en vez de enviar el formulario; la coma también lo cierra.
          if (ev.key === "Enter" || ev.key === ",") { ev.preventDefault(); if (e.texto.trim()) e.agregar(); }
        }}
        onPaste={(ev) => {
          const pegado = ev.clipboardData.getData("text");
          if (/[\n,;]/.test(pegado)) { ev.preventDefault(); e.agregar(`${e.texto}${pegado}`); }
        }} />
      {sugeridos.length > 0 && <datalist id={`${id}-opciones`}>{sugeridos.map((s) => <option key={s} value={s} />)}</datalist>}
      <Button type="button" variant="outline" size="sm" className="h-8" disabled={!e.texto.trim()} onClick={() => e.agregar()}>
        <PlusIcon aria-hidden className="size-3.5" /> Agregar
      </Button>
    </div>
  );
}

const BOTON = "grid size-6 shrink-0 place-items-center rounded-sm text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * Nombres de columna de un dato. El primero es el principal (el que se busca primero en el archivo); los demás son
 * alternativos y se prueban en el orden en que aparecen. `sugeridos`: columnas del archivo probado que nadie usa.
 */
export function NombresColumna({ inicial, etiqueta, sugeridos }: { inicial: string[]; etiqueta: string; sugeridos: string[] }) {
  const id = useId();
  const e = useEtiquetas(inicial, 20, normalizarEncabezado);
  const [principal, ...alternativos] = e.paraEnviar;
  const propios = new Set(e.valores.map(normalizarEncabezado));
  const libres = sugeridos.filter((s) => !propios.has(normalizarEncabezado(s)));
  return (
    <div className="space-y-2">
      <input type="hidden" name="principal" value={principal ?? ""} />
      <input type="hidden" name="alternativos" value={alternativos.join("\n")} />
      <p className="text-sm text-neutral-700" id={`${id}-titulo`}>Nombres de la columna en el Excel</p>
      <ol aria-labelledby={`${id}-titulo`} className="flex flex-wrap items-center gap-2">
        {e.valores.map((v, i) => (
          <li key={v} className={`flex max-w-full items-center gap-1 border py-0.5 pr-0.5 pl-2 text-sm ${i === 0 ? "border-neutral-900 bg-white" : "border-neutral-300 bg-white"}`}>
            <span className="min-w-0 font-mono text-[13px] break-words">{v}</span>
            {i === 0
              ? <span className="bg-neutral-900 px-1.5 py-0.5 text-[11px] font-medium text-white">principal</span>
              : (
                <>
                  <span className="text-[11px] text-neutral-500">{i === 1 ? "alternativo" : `alternativo ${i}`}</span>
                  <button type="button" className={BOTON} onClick={() => e.subir(i, true)} title="Dejarlo como principal" aria-label={`Dejar «${v}» como nombre principal de ${etiqueta}`}>
                    <StarIcon aria-hidden className="size-3.5" />
                  </button>
                  {i > 1 && (
                    <button type="button" className={BOTON} onClick={() => e.subir(i)} title="Probarlo antes que el anterior" aria-label={`Subir «${v}» un puesto`}>
                      <ArrowUpIcon aria-hidden className="size-3.5" />
                    </button>
                  )}
                </>
              )}
            <button type="button" className={BOTON} onClick={() => e.quitar(i)} disabled={e.valores.length === 1}
              title={e.valores.length === 1 ? "Debe quedar al menos un nombre" : "Quitar"} aria-label={`Quitar «${v}»`}>
              <XIcon aria-hidden className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
      <Agregar id={`${id}-nuevo`} e={e} etiqueta={`Otro nombre con el que puede venir ${etiqueta}`} placeholder="Otro nombre con el que puede venir…" sugeridos={libres} />
      {libres.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          Columnas del archivo probado que no se usan:
          {libres.slice(0, 8).map((s) => (
            <button key={s} type="button" onClick={() => e.agregar(s)} className="border border-dashed border-neutral-400 px-1.5 py-0.5 font-mono text-neutral-700 hover:border-neutral-900 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              + {s}
            </button>
          ))}
        </p>
      )}
      <p className="max-w-prose text-xs text-neutral-500">
        Se busca primero el principal; si el archivo no lo trae, se usa el primer alternativo que venga. No importan mayúsculas, tildes ni signos.
      </p>
      {e.aviso && <p role="status" className="text-xs text-amber-800">{e.aviso}</p>}
      {e.cambiado && <p role="status" className="text-xs font-medium text-neutral-900">Hay cambios sin guardar.</p>}
    </div>
  );
}

/** «Desglose*» salta todas las hojas que empiezan con «Desglose». */
const esPrefijo = (h: string) => h.endsWith("*");

/** Hojas del Excel que se saltan. Una etiqueta puede valer para todas las hojas que empiecen igual (termina en «*»). */
export function HojasSaltadas({ inicial }: { inicial: string[] }) {
  const id = useId();
  // «Desglose» y «Desglose*» son reglas distintas: la llave conserva el asterisco.
  const [empiezan, setEmpiezan] = useState(false);
  const conRegla = (t: string) => (empiezan && t.trim() && !esPrefijo(t.trim()) ? `${t.trim()}*` : t);
  const e = useEtiquetas(inicial, 30, (t) => `${normalizarEncabezado(t)}${esPrefijo(t.trim()) ? "*" : ""}`, partirLineas, conRegla);
  const agregar = () => { e.agregar(); setEmpiezan(false); };
  return (
    <div className="min-w-0 space-y-2">
      <input type="hidden" name="hojas" value={e.paraEnviar.join("\n")} />
      <p className="text-sm text-neutral-700" id={`${id}-titulo`}>Hojas que se saltan</p>
      {e.valores.length === 0 ? (
        <p className="text-xs text-neutral-500">Ninguna: se lee toda hoja que traiga las columnas.</p>
      ) : (
        <ul aria-labelledby={`${id}-titulo`} className="flex flex-wrap items-center gap-2">
          {e.valores.map((v, i) => (
            <li key={v} className="flex max-w-full items-center gap-1 border border-neutral-300 bg-white py-0.5 pr-0.5 pl-2 text-sm">
              {esPrefijo(v) && <span className="text-[11px] text-neutral-500">empiezan con</span>}
              <span className="min-w-0 font-mono text-[13px] break-words">{esPrefijo(v) ? v.slice(0, -1) : v}</span>
              <button type="button" className={BOTON} onClick={() => e.quitar(i)} title="Dejar de saltarla" aria-label={`Dejar de saltar «${v}»`}>
                <XIcon aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={`${id}-nueva`} className="sr-only">Nombre de una hoja que no es de ventas</label>
          <Input id={`${id}-nueva`} value={e.texto} placeholder="Nombre de la hoja…" maxLength={100} className="h-8 max-w-72 min-w-0 flex-1 text-sm md:text-sm"
            onChange={(ev) => e.setTexto(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); if (e.texto.trim()) agregar(); } }} />
          <Button type="button" variant="outline" size="sm" className="h-8" disabled={!e.texto.trim()} onClick={agregar}>
            <PlusIcon aria-hidden className="size-3.5" /> Agregar
          </Button>
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-700">
          <input type="checkbox" checked={empiezan} onChange={(ev) => setEmpiezan(ev.target.checked)} className="size-4" />
          Saltar todas las que empiecen así (el nombre cambia cada mes)
        </label>
      </div>
      <p className="max-w-prose text-xs text-neutral-500">
        Hojas de apoyo que no traen ventas línea por línea, como resúmenes o tablas dinámicas. Las demás hojas sin las columnas también se
        saltan, pero la carga lo avisa.
      </p>
      {e.aviso && <p role="status" className="text-xs text-amber-800">{e.aviso}</p>}
      {e.cambiado && <p role="status" className="text-xs font-medium text-neutral-900">Hay cambios sin guardar.</p>}
    </div>
  );
}
