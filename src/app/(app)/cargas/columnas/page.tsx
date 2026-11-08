import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requerirGestorCargas } from "@/lib/auth/acceso";
import { CAMPOS, TIPOS, type Campo, type MapeoCarga } from "@/lib/cargas/columnas";
import { bitacoraColumnas, cargasParaProbar, configColumnas, probarCarga, type CambioColumnas, type Prueba } from "@/lib/cargas/columnas-servidor";
import type { PruebaHoja } from "@/lib/cargas/ingesta";
import { fechaLocal } from "@/lib/format";
import { Reintentar } from "../formularios";
import { FormColumna, FormFormato } from "./formularios";

/** Leer el archivo para probarlo puede tardar unos segundos con un mes completo. */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADO: Record<string, string> = {
  recibida: "subida incompleta", procesando: "procesando", validada: "lista para publicar", con_errores: "con errores", publicada: "publicada", retirada: "retirada",
};
/** 0 → A, 26 → AA: como Excel nombra las columnas. */
const letra = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letra(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const lista = (xs: string[]) => xs.map((x) => `«${x}»`).join(", ");

/** Columnas del Excel (G10, S26): solo quien gestiona cargas (admin o aprobador). */
export default async function Columnas(props: PageProps<"/cargas/columnas">) {
  await requerirGestorCargas(); // el layout no se vuelve a ejecutar en cada navegación
  const sp = await props.searchParams;
  const probar = typeof sp.probar === "string" && UUID.test(sp.probar) ? sp.probar : null;
  const [config, cargas, cambios, prueba] = await Promise.all([
    configColumnas(), cargasParaProbar(), bitacoraColumnas(), probar ? probarCarga(probar) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/cargas" className="text-xs text-neutral-500 underline">← Cargas y versiones</Link>
        <h1 className="text-xl font-semibold">Columnas del Excel</h1>
        <p className="text-sm text-neutral-500">
          Cada dato que usa la plataforma (fecha, ruta, venta neta…) se llena con la columna del Excel que tenga alguno de los nombres de
          abajo. Si el cubo cambia el nombre de una columna, agrega el nombre nuevo aquí y la carga la reconoce sin tocar el sistema.
        </p>
      </div>

      <section className="space-y-1 border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <h2 className="font-semibold">Cómo se leen las columnas</h2>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>Se buscan por nombre: el orden de las columnas no importa, ni las mayúsculas, tildes, espacios o signos.</li>
          <li>Columnas que no son de ningún dato (como «Año» o «Mes Nom») se ignoran.</li>
          <li>Si falta una columna obligatoria, o hay dos columnas para el mismo dato, esa hoja no se carga y el error dice qué encabezados trae.</li>
          <li>Los cambios aplican desde la próxima carga. Lo ya cargado o publicado no cambia; cada carga guarda cómo se leyeron sus columnas.</li>
        </ul>
      </section>

      <section id="probar" className="space-y-3 border border-neutral-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-semibold">Probar con un archivo subido</h2>
          <p className="text-xs text-neutral-500">Lee los encabezados del archivo con la configuración de ahora, sin cargar nada.</p>
        </div>
        {cargas.length === 0 ? (
          <p className="text-sm text-neutral-500">No hay archivos subidos desde la app. Sube uno en Cargas y versiones y vuelve aquí.</p>
        ) : (
          <form method="get" action="/cargas/columnas#probar" className="flex flex-wrap items-end gap-3">
            <label className="block min-w-0 flex-1 space-y-1 text-sm">
              <span className="text-neutral-700">Archivo</span>
              <select name="probar" defaultValue={probar ?? cargas[0].id} className="block h-9 w-full min-w-0 border border-input bg-background px-2 text-sm">
                {cargas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre_archivo} · {ESTADO[c.estado] ?? c.estado} · {fechaLocal(c.creado_en)}</option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline">Probar</Button>
          </form>
        )}
        {prueba && <ResultadoPrueba prueba={prueba} mapeo={config} />}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Datos y nombres de columna aceptados</h2>
        <ul className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
          {config.columnas.map((c) => (
            <li key={c.campo} className="space-y-2 p-3">
              <div className="grid gap-2 sm:grid-cols-[16rem_minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{CAMPOS[c.campo].etiqueta}</div>
                  <div className="text-xs text-neutral-500"><span className="font-mono">{c.campo}</span> · {TIPOS[CAMPOS[c.campo].tipo]}</div>
                </div>
                <div className="flex min-w-0 flex-wrap gap-1">
                  {c.encabezados.map((e) => <span key={e} className="border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-xs break-all">{e}</span>)}
                </div>
                <div>
                  {c.obligatoria ? <Badge variant="secondary">Obligatoria</Badge> : <Badge variant="outline">Puede faltar</Badge>}
                </div>
              </div>
              <details className="group">
                <summary className="cursor-pointer text-xs text-neutral-600 underline">Cambiar nombres{c.puede_faltar ? " u obligatoriedad" : ""}</summary>
                <div className="mt-2 border border-neutral-200 bg-neutral-50/60 p-3">
                  <FormColumna campo={c.campo} encabezados={c.encabezados} obligatoria={c.obligatoria} puedeFaltar={c.puede_faltar} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <p className="text-xs text-neutral-500">
          Los datos los define el sistema porque el dashboard, el asistente y las alertas dependen de ellos. Un dato nuevo (por ejemplo, vendedor)
          necesita un cambio de Intelia; aquí se configura cómo se llaman en el Excel.
        </p>
      </section>

      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Formato del archivo</h2>
        <FormFormato fila={config.filaEncabezado} hojas={config.hojasExcluidas} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Historial de cambios</h2>
        {cambios.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay cambios: se usan los nombres de la exportación del cubo.</p>
        ) : (
          <ul className="space-y-1 border border-neutral-200 bg-white p-4 text-sm">
            {cambios.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-neutral-500">{fechaLocal(c.creado_en)}</span>
                <span>{c.usuario ?? "Alguien"} {descripcion(c)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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
  if (agregados.length) partes.push(`agregó ${lista(agregados)}`);
  if (quitados.length) partes.push(`quitó ${lista(quitados)}`);
  if (c.antes?.obligatoria !== c.despues?.obligatoria) partes.push(c.despues?.obligatoria ? "la volvió obligatoria" : "la dejó como opcional");
  return `en ${etiqueta}: ${partes.join(", ") || "cambió el orden de los nombres"}.`;
}

function ResultadoPrueba({ prueba, mapeo }: { prueba: Prueba; mapeo: MapeoCarga }) {
  if ("error" in prueba) return <p role="alert" className="text-sm text-red-700">{prueba.error}</p>;
  const { carga, hojas } = prueba;
  const cargables = hojas.filter((h) => h.lectura?.valida);
  const reintentable = ["recibida", "con_errores"].includes(carga.estado);
  return (
    <div className="space-y-3">
      <div className={`flex flex-wrap items-center gap-3 border p-3 text-sm ${cargables.length ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-red-300 bg-red-50 text-red-900"}`}>
        <span className="min-w-0 flex-1">
          <strong className="break-all">{carga.nombre_archivo}</strong>:{" "}
          {cargables.length
            ? `con la configuración de ahora se cargarían ${cargables.length === 1 ? "1 hoja" : `${cargables.length} hojas`} (${lista(cargables.map((h) => h.hoja))}).`
            : "con la configuración de ahora no se cargaría ninguna hoja."}
          {reintentable && cargables.length > 0 && " Esta carga no se procesó: pulsa Reintentar para cargarla con estas columnas."}
          {!reintentable && " Esta carga ya se procesó; la prueba solo muestra cómo se leería hoy."}
        </span>
        {reintentable && cargables.length > 0 && <Reintentar id={carga.id} />}
      </div>
      {hojas.map((h) => <HojaProbada key={h.hoja} h={h} mapeo={mapeo} />)}
    </div>
  );
}

function HojaProbada({ h, mapeo }: { h: PruebaHoja; mapeo: MapeoCarga }) {
  const titulo = <span className="font-medium break-all">Hoja «{h.hoja}»</span>;
  if (h.excluida) return <p className="text-sm text-neutral-500">{titulo}: se salta (está en las hojas que se saltan).</p>;
  if (!h.lectura) return <p className="text-sm text-neutral-500">{titulo}: no tiene encabezados en la fila {mapeo.filaEncabezado}; no se carga.</p>;
  const l = h.lectura;
  const repetido = new Map(l.repetidos.map((r) => [r.campo, r.encabezados]));
  const encontrado = new Map(l.encontrados.map((e) => [e.campo, e]));
  const resumen = l.valida
    ? l.faltanOpcionales.length ? `${l.faltanOpcionales.length} opcionales no vienen y se cargarían vacías` : "todos los datos encontrados"
    : [l.faltan.length && `faltan ${l.faltan.length} datos obligatorios`, l.repetidos.length && `${l.repetidos.length} con varias columnas`].filter(Boolean).join(" y ");
  // Las hojas que no se cargan (casi siempre resúmenes) van cerradas: abiertas llenan la pantalla de rojo.
  return (
    <details open={l.valida} className="group space-y-2 border border-neutral-200 p-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
        {titulo}
        {l.valida ? <Badge>Se carga</Badge> : <Badge variant="destructive">No se carga</Badge>}
        <span className="text-xs text-neutral-500">{resumen}</span>
      </summary>
      <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {mapeo.columnas.map((c) => {
          const e = encontrado.get(c.campo), r = repetido.get(c.campo);
          return (
            <li key={c.campo} className="flex min-w-0 gap-1.5">
              <span className={`shrink-0 ${e ? "text-emerald-700" : r || l.faltan.includes(c.campo) ? "text-red-700" : "text-amber-700"}`}>{e ? "✓" : r ? "✕" : l.faltan.includes(c.campo) ? "✕" : "!"}</span>
              <span className="min-w-0">
                <span className="text-neutral-700">{CAMPOS[c.campo].etiqueta}</span>{" "}
                <span className="text-neutral-500 break-all">
                  {e ? <>← columna {letra(e.columna)} «{e.encabezado}»</>
                    : r ? <>varias columnas: {lista(r)}</>
                    : l.faltan.includes(c.campo) ? <>falta (acepta {lista(c.encabezados)})</>
                    : <>no viene: se cargaría vacía</>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {l.sinUsar.length > 0 && <p className="mt-2 text-xs text-neutral-500 break-words">Columnas que no se usan: {lista(l.sinUsar)}.</p>}
    </details>
  );
}
