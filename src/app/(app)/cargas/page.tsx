import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requerirAcceso } from "@/lib/auth/acceso";
import { gestionaCargas } from "@/lib/auth/reglas";
import { esParcial } from "@/lib/cargas/alertas";
import { alertasDe, aprobacionesDe, listarCargas, mesesDeCargas, versiones } from "@/lib/cargas/servidor";
import type { Alerta, Aprobacion, FilaCarga, Mes, RolPaso, Version } from "@/lib/cargas/tipos";
import { conteo, fechaCorta, fechaLocal, periodoCorto, periodoLargo } from "@/lib/format";
import { AnularAprobacion, Descartar, FormAprobar, FormCargar, FormConciliar, FormPublicar, FormRetirar, Reintentar } from "./formularios";

/** Publicar recalcula los metadatos de la versión sobre todo el cubo (~15 s con 1 M de filas). */
export const maxDuration = 300;

const ESTADO_CARGA: Record<string, { txt: string; variante: "default" | "secondary" | "outline" | "destructive" }> = {
  recibida: { txt: "Subida incompleta", variante: "outline" },
  procesando: { txt: "Procesando", variante: "secondary" },
  validada: { txt: "Lista para publicar", variante: "default" },
  con_errores: { txt: "Con errores", variante: "destructive" },
  publicada: { txt: "Publicada", variante: "secondary" },
  retirada: { txt: "Retirada", variante: "outline" },
};

/** "ene 2025 – oct 2026 (22 meses)" si son seguidos; si no, la lista. */
function meses(m: { anio: number; mes: number }[] | null) {
  if (!m?.length) return "—";
  const k = m.map((x) => x.anio * 12 + x.mes);
  const seguidos = k.every((v, i) => i === 0 || v === k[i - 1] + 1);
  if (m.length === 1) return periodoCorto(m[0]);
  return seguidos ? `${periodoCorto(m[0])} – ${periodoCorto(m.at(-1)!)} (${m.length} meses)` : m.map(periodoCorto).join(", ");
}

/** Aviso tras publicar (?publicada=N&correo=…): la tarjeta de la carga ya no está para mostrarlo. */
const CORREO: Record<string, string> = {
  enviado: "El resumen se envió por correo al equipo.",
  desarrollo: "En desarrollo no se envían correos: lo que se habría enviado quedó en el log del servidor.",
  error: "No se pudo enviar el resumen por correo. Compártelo desde la página del resumen (Imprimir o guardar PDF).",
};

export default async function Cargas(props: PageProps<"/cargas">) {
  const usuario = await requerirAcceso();
  const sp = await props.searchParams;
  const gestor = gestionaCargas(usuario);
  const historial = await versiones();
  const cargas = gestor ? (await listarCargas()).filter((c) => !["publicada", "retirada"].includes(c.estado)) : [];
  const validadas = cargas.filter((c) => c.estado === "validada").map((c) => c.id);
  const [alertas, mesesCarga, aprobaciones] = validadas.length
    ? await Promise.all([alertasDe(validadas), mesesDeCargas(validadas), aprobacionesDe(validadas)])
    : [new Map<string, Alerta[]>(), new Map<string, Mes[]>(), new Map<string, Aprobacion>()];
  const vigente = historial.find((v) => !v.retirada_en);
  const publicada = gestor ? historial.find((v) => String(v.version) === sp.publicada) : undefined;
  const correo = typeof sp.correo === "string" ? CORREO[sp.correo] : undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Cargas y versiones</h1>
        <p className="max-w-prose text-sm text-neutral-500">
          El dashboard y el asistente leen siempre la versión publicada vigente. Cada mes se sube la exportación del mes: reemplaza
          solo los meses que trae el archivo y queda como una versión nueva, con su historial.
        </p>
      </div>

      {publicada && (
        <section role="status" className="space-y-1 border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-semibold">Publicaste la versión v{publicada.version}. El dashboard y el asistente ya la muestran.</p>
          {correo && <p>{correo}</p>}
          <p>
            <Link href={`/resumen?version=${publicada.version}`} className="font-medium underline">Ver el resumen ejecutivo del mes</Link>
            {" · "}Después, concilia con BI (paso 5 de la guía).
          </p>
        </section>
      )}

      {gestor && (
        <section className="space-y-3 border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Carga del mes</h2>
          <ol className="max-w-prose list-decimal space-y-0.5 pl-5 text-sm text-neutral-700">
            <li>Exporta del cubo el mes cerrado y súbelo aquí. Las columnas se reconocen por nombre (ver <Link href="/cargas/columnas" className="underline">Columnas del Excel</Link>).</li>
            <li>Revisa las alertas (cambios contra lo publicado, saltos raros, canales nuevos) y aprueba la carga.</li>
            <li>Publica. Si algo salió mal, retira la versión y vuelve a regir la anterior.</li>
          </ol>
          <FormCargar />
          <p className="text-xs text-neutral-500">
            ¿Un canal nuevo o escrito distinto? <Link href="/cargas/homologacion" className="underline">Homologación de canales</Link>
            {" · "}¿Una columna con otro nombre? <Link href="/cargas/columnas" className="underline">Columnas del Excel</Link>
          </p>
        </section>
      )}

      {gestor && cargas.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Cargas sin publicar</h2>
          {cargas.map((c) => <TarjetaCarga key={c.id} c={c} alertas={alertas.get(c.id) ?? []} meses={mesesCarga.get(c.id) ?? []} aprobacion={aprobaciones.get(c.id)}
            siguiente={Math.max(0, ...historial.map((v) => v.version)) + 1} mesesVigente={vigente?.meses ?? []} />)}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Versiones publicadas</h2>
        {/* En el celular la tabla dejaba «Acciones» fuera de la pantalla: ahí va una versión por bloque. */}
        <ul className="divide-y divide-neutral-200 border border-neutral-200 bg-white sm:hidden">
          {historial.map((v) => (
            <TarjetaVersion key={v.version} v={v} vigente={v.version === vigente?.version} gestor={gestor}
              retirable={historial.some((o) => !o.retirada_en && o.version < v.version)} />
          ))}
        </ul>
        <div className="hidden border border-neutral-200 bg-white sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versión</TableHead>
                <TableHead>Corte</TableHead>
                <TableHead>Publicada</TableHead>
                <TableHead>Qué trajo</TableHead>
                <TableHead>BI</TableHead>
                {gestor && <TableHead>Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {historial.map((v) => (
                <FilaVersion key={v.version} v={v} vigente={v.version === vigente?.version} gestor={gestor}
                  retirable={historial.some((o) => !o.retirada_en && o.version < v.version)} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

/** Solo se retira la vigente, y solo si hay una anterior a la cual volver. */
function FilaVersion({ v, vigente, gestor, retirable }: { v: Version; vigente: boolean; gestor: boolean; retirable: boolean }) {
  return (
    <TableRow className={v.retirada_en ? "text-neutral-400" : ""}>
      <TableCell className="align-top">
        <div className="font-medium">v{v.version}</div>
        {vigente ? <Badge>Vigente</Badge> : v.retirada_en ? <Badge variant="outline">Retirada</Badge> : <span className="text-xs text-neutral-500">anterior</span>}
      </TableCell>
      <TableCell className="align-top">{fechaCorta(v.fecha_corte)}{!v.ultimo_mes_cerrado && <div className="text-xs text-neutral-500">último mes parcial</div>}</TableCell>
      <TableCell className="align-top text-xs">
        {fechaLocal(v.publicado_en)}<Autoria v={v} />
      </TableCell>
      <TableCell className="max-w-96 align-top text-xs whitespace-normal">
        <div>{v.archivo} · {meses(v.meses)}</div>
        {v.meses_reemplazados.length > 0 && <div className="text-neutral-500">reemplazó {meses(v.meses_reemplazados)}</div>}
        {v.notas && <div className="text-neutral-600">{v.notas}</div>}
        {v.retirada_en && <div className="text-red-700">Retirada el {fechaLocal(v.retirada_en)}: {v.motivo_retiro}</div>}
      </TableCell>
      <TableCell className="max-w-72 align-top text-xs whitespace-normal">
        {v.conciliada_bi ? <><Badge variant="secondary">Conciliada</Badge><div className="mt-1 text-neutral-600">{v.conciliada_nota}</div></> : "Sin conciliar"}
        <div className="mt-1"><Link href={`/resumen?version=${v.version}`} className="text-neutral-700 underline">Resumen del mes</Link></div>
      </TableCell>
      {gestor && (
        <TableCell className="align-top">
          {vigente && (
            <div className="flex flex-col items-start gap-2">
              {!v.conciliada_bi && <FormConciliar version={v.version} />}
              {retirable && <FormRetirar version={v.version} />}
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

function TarjetaVersion({ v, vigente, gestor, retirable }: { v: Version; vigente: boolean; gestor: boolean; retirable: boolean }) {
  return (
    <li className={`space-y-2 p-3 text-sm ${v.retirada_en ? "text-neutral-400" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">v{v.version}</span>
        {vigente ? <Badge>Vigente</Badge> : v.retirada_en ? <Badge variant="outline">Retirada</Badge> : <span className="text-xs text-neutral-500">anterior</span>}
        <span className="text-xs text-neutral-500">corte {fechaCorta(v.fecha_corte)}{!v.ultimo_mes_cerrado && " · último mes parcial"}</span>
      </div>
      <div className="space-y-0.5 text-xs break-words">
        <div>{v.archivo} · {meses(v.meses)}</div>
        {v.meses_reemplazados.length > 0 && <div className="text-neutral-500">reemplazó {meses(v.meses_reemplazados)}</div>}
        <div className="text-neutral-500">Publicada {fechaLocal(v.publicado_en)}<Autoria v={v} /></div>
        {v.notas && <div className="text-neutral-600">{v.notas}</div>}
        {v.retirada_en && <div className="text-red-700">Retirada el {fechaLocal(v.retirada_en)}: {v.motivo_retiro}</div>}
        <div>{v.conciliada_bi ? `Conciliada con BI: ${v.conciliada_nota}` : "Sin conciliar con BI"} · <Link href={`/resumen?version=${v.version}`} className="text-neutral-700 underline">Resumen del mes</Link></div>
      </div>
      {gestor && vigente && (
        <div className="flex flex-col items-start gap-2">
          {!v.conciliada_bi && <FormConciliar version={v.version} />}
          {retirable && <FormRetirar version={v.version} />}
        </div>
      )}
    </li>
  );
}

/**
 * El error de columnas trae la lista completa de encabezados del archivo y un consejo: en la tarjeta va solo qué falta,
 * con el arreglo a un clic; los encabezados quedan plegados para quien los quiera comparar.
 */
function ErrorCarga({ id, error }: { id: string; error: string }) {
  const [titulo, resto] = error.split(" Encabezados del archivo: ");
  const encabezados = resto?.replace(/\. Si la columna cambió de nombre.*$/, "").replace(/\.$/, "");
  const deColumnas = /columna|encabezado/i.test(error);
  return (
    <div className="space-y-2">
      <p role="alert" className="max-w-prose text-sm text-red-700 break-words">{encabezados ? titulo : error}</p>
      {deColumnas && (
        <Link href={`/cargas/columnas?probar=${id}#probar`}
          className="inline-flex min-h-8 items-center border border-neutral-300 bg-white px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-neutral-50">
          Arreglar las columnas de este archivo
        </Link>
      )}
      {encabezados && (
        <details className="max-w-prose text-xs text-neutral-600">
          <summary className="inline-flex min-h-8 cursor-pointer items-center underline underline-offset-2">Ver los encabezados que trae el archivo</summary>
          <p className="break-words">{encabezados}.</p>
        </details>
      )}
    </div>
  );
}

const TONO: Record<Alerta["nivel"], string> = {
  bloqueo: "border-red-300 bg-red-50 text-red-900",
  revisar: "border-amber-300 bg-amber-50 text-amber-900",
  info: "border-neutral-200 bg-neutral-50 text-neutral-700",
};
const ETIQUETA: Record<Alerta["nivel"], string> = { bloqueo: "Bloquea", revisar: "Revisar", info: "Info" };

const ROL: Record<RolPaso, string> = { admin: "admin", aprobador: "aprobador", servicio: "script de Intelia" };
const quien = (nombre: string | null, rol: RolPaso | null) => `${nombre ?? (rol === "servicio" ? "Intelia" : "alguien")}${rol ? ` (${ROL[rol]})` : ""}`;

/** Quién aprobó y quién publicó (V1-07). Las versiones de antes de G11 solo tienen quién publicó. */
function Autoria({ v }: { v: Version }) {
  return (
    <>
      {v.aprobado_en && (
        <div title={v.motivo_aprobacion ?? undefined}>
          aprobó {quien(v.aprobado_por, v.rol_aprobacion)}{v.alertas_aceptadas > 0 && `, aceptó ${v.alertas_aceptadas} ${v.alertas_aceptadas === 1 ? "alerta" : "alertas"}`}
        </div>
      )}
      {(v.publicado_por || v.rol_publicacion) && <div>publicó {quien(v.publicado_por, v.rol_publicacion)}</div>}
    </>
  );
}

function TarjetaCarga({ c, alertas, meses: m, siguiente, mesesVigente, aprobacion }: {
  c: FilaCarga; alertas: Alerta[]; meses: Mes[]; siguiente: number; mesesVigente: { anio: number; mes: number }[]; aprobacion?: Aprobacion;
}) {
  const enVigente = new Set(mesesVigente.map((x) => x.anio * 12 + x.mes));
  const orden = [...m].sort((a, b) => a.anio * 12 + a.mes - (b.anio * 12 + b.mes));
  const reemplaza = orden.filter((x) => enVigente.has(x.anio * 12 + x.mes)), agrega = orden.filter((x) => !enVigente.has(x.anio * 12 + x.mes));
  const estado = ESTADO_CARGA[c.estado] ?? { txt: c.estado, variante: "outline" as const };
  const ultimo = orden.at(-1);
  const bloqueo = alertas.some((a) => a.nivel === "bloqueo") ? "hay una alerta «Bloquea» arriba; corrige el archivo y súbelo de nuevo." : null;
  return (
    <div className="space-y-3 border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">{c.nombre_archivo}</div>
          <div className="text-xs text-neutral-500">
            Subida {fechaLocal(c.creado_en)}
            {c.periodo_desde && c.periodo_hasta && ` · ${fechaCorta(c.periodo_desde)} a ${fechaCorta(c.periodo_hasta)}`}
            {c.filas_cargadas != null && ` · ${conteo(c.filas_cargadas)} filas`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={estado.variante}>{estado.txt}</Badge>
          {["recibida", "con_errores"].includes(c.estado) && <Reintentar id={c.id} />}
          {c.estado !== "procesando" && <Descartar id={c.id} />}
        </div>
      </div>
      {c.error && <ErrorCarga id={c.id} error={c.error} />}
      {c.estado === "validada" && (
        <>
          <ul className="space-y-1">
            {alertas.map((a, i) => (
              <li key={i} className={`border px-2 py-1 text-sm ${TONO[a.nivel]}`}>
                <span className="mr-2 text-xs font-semibold uppercase">{ETIQUETA[a.nivel]}</span>{a.texto}
              </li>
            ))}
          </ul>
          {m.some((x) => x.canales_sin_homologar.length > 0) && (
            <p className="text-xs text-neutral-600">
              Si BIA ya decidió a qué canal van, agrégalos en <Link href="/cargas/homologacion" className="underline">Homologación de canales</Link>: esta carga se actualiza al momento.
            </p>
          )}
          {ultimo && (aprobacion?.al_dia ? (
            <>
              <div role="status" className="space-y-1 border-t border-neutral-200 pt-4 text-sm">
                <p>
                  <span className="font-semibold">1. Aprobada</span> por {quien(aprobacion.usuario, aprobacion.rol)} el {fechaLocal(aprobacion.creado_en)}
                  {" · "}{periodoLargo(ultimo)} {aprobacion.ultimo_mes_cerrado ? "completo" : "parcial"}
                </p>
                {aprobacion.motivo && (
                  <p className="max-w-prose text-neutral-600">
                    Aceptó {aprobacion.alertas.length === 1 ? "la alerta «Revisar»" : `${aprobacion.alertas.length} alertas «Revisar»`}: «{aprobacion.motivo}»
                  </p>
                )}
                <AnularAprobacion id={c.id} />
              </div>
              <FormPublicar id={c.id} version={siguiente} reemplaza={reemplaza.length ? meses(reemplaza) : null} agrega={agrega.length ? meses(agrega) : null}
                bloqueo={bloqueo} />
            </>
          ) : (
            <>
              {aprobacion && (
                <p role="status" className="max-w-prose border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-900">
                  La aprobación que dio {quien(aprobacion.usuario, aprobacion.rol)} el {fechaLocal(aprobacion.creado_en)} ya no vale: la carga cambió después
                  (homologación de canales u otra versión publicada). Revisa las alertas de nuevo y vuelve a aprobarla.
                </p>
              )}
              <FormAprobar id={c.id} ultimoMes={periodoLargo(ultimo)} mesCompletoSugerido={!esParcial(ultimo)}
                revisar={alertas.filter((a) => a.nivel === "revisar").length} bloqueo={bloqueo} />
            </>
          ))}
        </>
      )}
    </div>
  );
}
