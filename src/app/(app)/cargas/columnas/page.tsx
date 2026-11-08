import { CheckCircleIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requerirGestorCargas } from "@/lib/auth/acceso";
import { CAMPOS, GRUPOS, NOMBRE_CUBO, sugerencias, TIPOS, type Campo, type ColumnaCarga, type LecturaHoja, type MapeoCarga } from "@/lib/cargas/columnas";
import { bitacoraColumnas, cargasParaProbar, configColumnas, probarCarga, type CambioColumnas, type Prueba } from "@/lib/cargas/columnas-servidor";
import type { PruebaHoja } from "@/lib/cargas/ingesta";
import { fechaLocal } from "@/lib/format";
import { Reintentar } from "../formularios";
import { ArreglarDato, CLASE_LISTA, FormColumna, FormFormato, SaltarHoja } from "./formularios";

/** Leer el archivo para probarlo tarda unos segundos con un mes completo. */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADO: Record<string, string> = {
  recibida: "subida incompleta", procesando: "procesando", validada: "lista para publicar", con_errores: "con errores", publicada: "publicada", retirada: "retirada",
};
/** Con más datos faltantes que esto, la hoja es un resumen o una tabla dinámica: no se ofrecen arreglos, solo saltarla. */
const ARREGLABLE = 4;

/** 0 → A, 26 → AA: como Excel nombra las columnas. */
const letra = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letra(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const lista = (xs: string[]) => xs.map((x) => `«${x}»`).join(", ");
const hojas = (n: number) => (n === 1 ? "1 hoja" : `${n} hojas`);

/** Columnas del Excel (G10, S26): solo quien gestiona cargas (admin o aprobador). */
export default async function Columnas(props: PageProps<"/cargas/columnas">) {
  await requerirGestorCargas(); // el layout no se vuelve a ejecutar en cada navegación
  const sp = await props.searchParams;
  const probar = typeof sp.probar === "string" && UUID.test(sp.probar) ? sp.probar : null;
  const [config, cargas, cambios, prueba] = await Promise.all([
    configColumnas(), cargasParaProbar(), bitacoraColumnas(), probar ? probarCarga(probar) : Promise.resolve(null),
  ]);
  const archivo = prueba && !("error" in prueba) ? prueba.carga.nombre_archivo : null;
  const porCampo = new Map(config.columnas.map((c) => [c.campo, c]));

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link href="/cargas" className="text-xs text-neutral-500 underline underline-offset-2">← Cargas y versiones</Link>
        <h1 className="text-xl font-semibold">Columnas del Excel</h1>
        <p className="max-w-prose text-sm text-neutral-600">
          Cada dato se llena con la columna que tenga su nombre principal o, si no viene, el primer alternativo que aparezca. Si el cubo
          renombra una columna, prueba el archivo aquí y agrega el nombre nuevo con un clic.
        </p>
        <details className="max-w-prose text-sm text-neutral-600">
          <summary className="cursor-pointer text-neutral-800 underline underline-offset-2">Cómo se leen las columnas</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Por nombre: no importa el orden ni las mayúsculas, tildes, espacios o signos («Café/Rep» = «CAFE REP»).</li>
            <li>Columnas que no son de ningún dato, como «Año» o «Mes Nom», se ignoran.</li>
            <li>Si falta una columna obligatoria, o el mismo nombre viene en dos columnas, la hoja no se carga y el error dice qué trae el archivo.</li>
            <li>Los cambios aplican desde la próxima carga. Lo ya cargado o publicado no cambia; cada carga guarda cómo se leyeron sus columnas.</li>
          </ul>
        </details>
      </header>

      <section id="probar" aria-labelledby="probar-titulo" className="space-y-4 border border-neutral-200 bg-white p-4">
        <div className="space-y-1">
          <h2 id="probar-titulo" className="text-sm font-semibold">Probar con un archivo subido</h2>
          <p className="max-w-prose text-xs text-neutral-500">Lee los encabezados con la configuración de ahora, sin cargar nada. Si falta un dato, puedes arreglarlo aquí mismo.</p>
        </div>
        {cargas.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay archivos subidos desde la app. Sube uno en Cargas y versiones y vuelve aquí.</p>
        ) : (
          <form method="get" action="/cargas/columnas#probar" className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-64 space-y-1 text-sm">
              <label htmlFor="probar-archivo" className="block text-neutral-700">Archivo</label>
              <select id="probar-archivo" name="probar" defaultValue={probar ?? cargas[0].id} className={CLASE_LISTA}>
                {cargas.map((c) => <option key={c.id} value={c.id}>{c.nombre_archivo} · {ESTADO[c.estado] ?? c.estado} · {fechaLocal(c.creado_en)}</option>)}
              </select>
            </div>
            <Button type="submit" variant="outline">Probar</Button>
          </form>
        )}
        {prueba && <ResultadoPrueba prueba={prueba} mapeo={config} />}
      </section>

      <section aria-labelledby="formato-titulo" className="space-y-3 border border-neutral-200 bg-white p-4">
        <h2 id="formato-titulo" className="text-sm font-semibold">Formato del archivo</h2>
        <FormFormato fila={config.filaEncabezado} hojas={config.hojasExcluidas} />
      </section>

      <section aria-labelledby="datos-titulo" className="space-y-4">
        <div className="space-y-1">
          <h2 id="datos-titulo" className="text-sm font-semibold">Datos y nombres de columna</h2>
          <p className="max-w-prose text-xs text-neutral-500">
            Los datos los define el sistema porque el dashboard, el asistente y las alertas dependen de ellos; aquí se configura cómo se llaman
            en el Excel. Un dato nuevo, como vendedor, necesita un cambio de Intelia.
          </p>
        </div>
        {GRUPOS.map((g) => (
          <div key={g.titulo} className="space-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{g.titulo}</h3>
            <div className="border border-neutral-200 bg-white">
              <div aria-hidden className="hidden grid-cols-[minmax(0,14rem)_minmax(0,1fr)_9rem] gap-4 border-b border-neutral-200 px-3 py-2 text-xs text-neutral-500 sm:grid">
                <span>Dato</span><span>Nombre principal y alternativos</span><span>La columna</span>
              </div>
              <ul className="divide-y divide-neutral-200">
                {g.campos.map((campo) => <FilaDato key={campo} c={porCampo.get(campo)!} probarId={archivo ? probar : null} archivo={archivo} />)}
              </ul>
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="historial-titulo" className="space-y-2">
        <h2 id="historial-titulo" className="text-sm font-semibold">Historial de cambios</h2>
        {cambios.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay cambios: se usan los nombres de la exportación del cubo.</p>
        ) : (
          <ul className="max-w-3xl space-y-1 border border-neutral-200 bg-white p-4 text-sm">
            {cambios.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-2">
                <span className="text-neutral-500 tabular-nums">{fechaLocal(c.creado_en)}</span>
                <span>{c.usuario ?? "Alguien"} {descripcion(c)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilaDato({ c, probarId, archivo }: { c: ColumnaCarga; probarId: string | null; archivo: string | null }) {
  const { etiqueta, tipo } = CAMPOS[c.campo];
  const [principal, ...alternativos] = c.encabezados;
  const personalizado = principal !== NOMBRE_CUBO[c.campo] || alternativos.length > 0;
  return (
    <li className="px-3 py-2">
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_9rem] sm:items-baseline">
        <div className="min-w-0">
          <span className="text-sm font-medium">{etiqueta}</span>
          <span className="block text-xs text-neutral-500">{TIPOS[tipo]}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
          <span className="border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-xs font-medium break-words">{principal}</span>
          {alternativos.map((a) => <span key={a} className="px-1 text-xs text-neutral-600 break-words">o «{a}»</span>)}
          {personalizado && <span className="text-xs text-neutral-400">· cambiado</span>}
        </div>
        <div className="text-xs text-neutral-600">
          {c.obligatoria ? "Obligatoria" : <Badge variant="outline">Puede faltar</Badge>}
        </div>
      </div>
      <details className="mt-1">
        <summary className="inline-flex min-h-8 cursor-pointer items-center text-xs text-neutral-700 underline underline-offset-2">
          Editar<span className="sr-only"> {etiqueta}</span>
        </summary>
        <div className="mt-2 space-y-2 bg-neutral-50 p-3">
          <p className="text-xs text-neutral-500">Nombre interno: <span className="font-mono">{c.campo}</span>{!c.puede_faltar && " · siempre obligatoria: el dashboard y las alertas la necesitan"}</p>
          <FormColumna campo={c.campo} etiqueta={etiqueta} principal={principal} alternativos={alternativos} obligatoria={c.obligatoria}
            puedeFaltar={c.puede_faltar} probarId={probarId} archivo={archivo} />
        </div>
      </details>
    </li>
  );
}

function descripcion(c: CambioColumnas) {
  if (c.tipo === "formato") {
    const partes: string[] = [];
    if (c.antes?.fila_encabezado !== c.despues?.fila_encabezado) partes.push(`la fila de encabezados de ${c.antes?.fila_encabezado} a ${c.despues?.fila_encabezado}`);
    if (JSON.stringify(c.antes?.hojas_excluidas) !== JSON.stringify(c.despues?.hojas_excluidas))
      partes.push(`las hojas que se saltan a ${c.despues?.hojas_excluidas?.length ? lista(c.despues.hojas_excluidas) : "ninguna"}`);
    return `cambió ${partes.join(" y ") || "el formato"}.`;
  }
  const etiqueta = c.campo && c.campo in CAMPOS ? CAMPOS[c.campo as Campo].etiqueta : c.campo;
  const partes: string[] = [];
  const antes = c.antes?.encabezados ?? [], despues = c.despues?.encabezados ?? [];
  const agregados = despues.filter((e) => !antes.includes(e)), quitados = antes.filter((e) => !despues.includes(e));
  if (antes[0] !== despues[0] && despues[0]) partes.push(`dejó «${despues[0]}» como principal`);
  if (agregados.filter((e) => e !== despues[0]).length) partes.push(`agregó ${lista(agregados.filter((e) => e !== despues[0]))}`);
  if (quitados.length) partes.push(`quitó ${lista(quitados)}`);
  if (c.antes?.obligatoria !== c.despues?.obligatoria) partes.push(c.despues?.obligatoria ? "la volvió obligatoria" : "la dejó como opcional");
  return `en ${etiqueta}: ${partes.join(", ") || "cambió el orden de los alternativos"}.`;
}

function ResultadoPrueba({ prueba, mapeo }: { prueba: Prueba; mapeo: MapeoCarga }) {
  if ("error" in prueba) return <p role="alert" className="text-sm text-red-700">{prueba.error}</p>;
  const { carga, hojas: todas } = prueba;
  const cargables = todas.filter((h) => h.lectura?.valida);
  const reintentable = ["recibida", "con_errores"].includes(carga.estado);
  return (
    <div className="space-y-3">
      <div role="status" className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm ${cargables.length ? "bg-emerald-50 text-emerald-950" : "bg-red-50 text-red-950"}`}>
        <p className="max-w-prose min-w-0 flex-1">
          <strong className="break-words">{carga.nombre_archivo}</strong>:{" "}
          {cargables.length
            ? `con la configuración de ahora se ${cargables.length === 1 ? "cargaría" : "cargarían"} ${hojas(cargables.length)} (${lista(cargables.map((h) => h.hoja))}).`
            : "con la configuración de ahora no se cargaría ninguna hoja."}
          {reintentable && (cargables.length ? " Esta carga no se procesó: reinténtala con estas columnas." : " Arregla los datos que faltan abajo y vuelve a probar.")}
          {!reintentable && " Esta carga ya se procesó; la prueba solo muestra cómo se leería hoy."}
        </p>
        {reintentable && cargables.length > 0 && <Reintentar id={carga.id} />}
      </div>
      {todas.map((h) => <HojaProbada key={h.hoja} h={h} mapeo={mapeo} />)}
    </div>
  );
}

/** Ícono con su significado en texto para lector de pantalla. */
function Marca({ tipo }: { tipo: "ok" | "falta" | "vacia" }) {
  const props = { "aria-hidden": true, className: "mt-0.5 size-4 shrink-0" } as const;
  if (tipo === "ok") return <><CheckCircleIcon {...props} weight="fill" className={`${props.className} text-emerald-700`} /><span className="sr-only">Encontrada: </span></>;
  if (tipo === "falta") return <><XCircleIcon {...props} weight="fill" className={`${props.className} text-red-700`} /><span className="sr-only">Falta: </span></>;
  return <><WarningCircleIcon {...props} weight="fill" className={`${props.className} text-amber-600`} /><span className="sr-only">No viene: </span></>;
}

function HojaProbada({ h, mapeo }: { h: PruebaHoja; mapeo: MapeoCarga }) {
  const titulo = <span className="font-medium break-words">Hoja «{h.hoja}»</span>;
  if (h.excluida) return <p className="text-sm text-neutral-500">{titulo}: se salta (está en las hojas que se saltan).</p>;
  if (!h.lectura) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600">
        <p>{titulo}: no tiene encabezados en la fila {mapeo.filaEncabezado}; no se carga.</p>
        <SaltarHoja hoja={h.hoja} />
      </div>
    );
  }
  const l = h.lectura;
  const total = mapeo.columnas.length;
  const resumen = l.valida
    ? `${l.encontrados.length}/${total} datos${l.faltanOpcionales.length ? ` · ${l.faltanOpcionales.length} opcionales vacíos` : ""}`
    : [l.faltan.length && `faltan ${l.faltan.length} datos obligatorios`, l.repetidos.length && `${l.repetidos.length} con el mismo nombre en dos columnas`].filter(Boolean).join(" · ");
  const arreglable = !l.valida && l.faltan.length <= ARREGLABLE;
  const sug = new Map(sugerencias(l, mapeo).map((s) => [s.campo, s.encabezado]));
  // Las hojas que no se cargan y no se pueden arreglar (resúmenes) van cerradas: abiertas llenan la pantalla de rojo.
  return (
    <details open={l.valida || arreglable} className="border-t border-neutral-200 pt-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
        {titulo}
        {l.valida ? <Badge variant="secondary" className="bg-emerald-100 text-emerald-900">Se carga</Badge> : <Badge variant="destructive">No se carga</Badge>}
        <span className="text-xs text-neutral-500">{resumen}</span>
      </summary>
      <div className="mt-3 space-y-3 pl-1">
        {!l.valida && !arreglable && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600">
            <p className="max-w-prose">Parece un resumen o una tabla dinámica: le faltan {l.faltan.length} de {total} datos. Si no trae ventas línea por línea, sáltala para que no avise cada mes.</p>
            <SaltarHoja hoja={h.hoja} />
          </div>
        )}
        <Problemas l={l} mapeo={mapeo} sug={sug} arreglable={l.valida || arreglable} />
        <details className="text-xs">
          <summary className="inline-flex min-h-8 cursor-pointer items-center text-neutral-700 underline underline-offset-2">Ver cómo se lee cada dato</summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {mapeo.columnas.map((c) => <LineaDato key={c.campo} c={c} l={l} />)}
          </ul>
          {l.sinUsar.length > 0 && <p className="mt-2 max-w-prose break-words text-neutral-500">Columnas que no se usan: {lista(l.sinUsar)}.</p>}
        </details>
      </div>
    </details>
  );
}

/** Solo lo que pide atención: datos que faltan (con su arreglo), opcionales vacíos, nombres repetidos y alternativos usados. */
function Problemas({ l, mapeo, sug, arreglable }: { l: LecturaHoja; mapeo: MapeoCarga; sug: Map<Campo, string>; arreglable: boolean }) {
  const faltantes = [...l.faltan.map((c) => ({ c, obligatoria: true })), ...l.faltanOpcionales.map((c) => ({ c, obligatoria: false }))];
  const alternos = l.encontrados.filter((e) => e.alternativo);
  if (!faltantes.length && !l.repetidos.length && !alternos.length && !l.descartadas.length)
    return <p className="flex items-center gap-1.5 text-sm text-neutral-700"><Marca tipo="ok" />Todos los datos se encontraron con su nombre principal.</p>;
  const aceptados = (campo: Campo) => mapeo.columnas.find((x) => x.campo === campo)?.encabezados ?? [];
  return (
    <ul className="space-y-2 text-sm">
      {arreglable && faltantes.map(({ c, obligatoria }) => (
        <li key={c} className="flex gap-1.5">
          <Marca tipo={obligatoria ? "falta" : "vacia"} />
          <div className="min-w-0">
            <span className="font-medium">{CAMPOS[c].etiqueta}</span>{" "}
            <span className="text-neutral-600">{obligatoria ? "no viene: la hoja no se carga" : "no viene: se cargaría vacía"} (acepta {lista(aceptados(c))}).</span>
            <ArreglarDato campo={c} etiqueta={CAMPOS[c].etiqueta} sugerida={sug.get(c) ?? null} sobran={l.sinUsar} />
          </div>
        </li>
      ))}
      {l.repetidos.map((r) => (
        <li key={r.campo} className="flex gap-1.5">
          <Marca tipo="falta" />
          <span><span className="font-medium">{CAMPOS[r.campo].etiqueta}</span> <span className="text-neutral-600">viene con el mismo nombre en dos columnas ({lista(r.encabezados)}): corrige el archivo.</span></span>
        </li>
      ))}
      {alternos.map((e) => (
        <li key={e.campo} className="flex gap-1.5 text-neutral-600">
          <Marca tipo="ok" />
          <span><span className="font-medium text-neutral-900">{CAMPOS[e.campo].etiqueta}</span> se lee de «{e.encabezado}» (columna {letra(e.columna)}), un nombre alternativo.</span>
        </li>
      ))}
      {l.descartadas.map((d) => (
        <li key={`${d.campo}-${d.encabezado}`} className="flex gap-1.5 text-neutral-600">
          <Marca tipo="vacia" />
          <span>También viene «{d.encabezado}» para {CAMPOS[d.campo].etiqueta.toLowerCase()}; se usa «{d.usada}», que tiene más prioridad.</span>
        </li>
      ))}
    </ul>
  );
}

function LineaDato({ c, l }: { c: ColumnaCarga; l: LecturaHoja }) {
  const e = l.encontrados.find((x) => x.campo === c.campo);
  const r = l.repetidos.find((x) => x.campo === c.campo);
  const tipo = e ? "ok" : r || l.faltan.includes(c.campo) ? "falta" : "vacia";
  return (
    <li className="flex min-w-0 gap-1.5">
      <Marca tipo={tipo} />
      <span className="min-w-0 break-words">
        <span className="text-neutral-800">{CAMPOS[c.campo].etiqueta}</span>{" "}
        <span className="text-neutral-500">
          {e ? `← columna ${letra(e.columna)} «${e.encabezado}»` : r ? `mismo nombre en ${lista(r.encabezados)}` : tipo === "falta" ? "falta" : "no viene: vacía"}
        </span>
      </span>
    </li>
  );
}
