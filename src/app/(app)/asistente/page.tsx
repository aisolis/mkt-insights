import { Chat, type ConversacionInicial, type Sugerencia } from "@/components/asistente/chat";
import { leerParams, periodoComparado, queryString } from "@/lib/dashboard/params";
import { describirFiltros, rango } from "@/lib/asistente/texto";
import { capital } from "@/lib/format";
import { configModelo } from "@/lib/asistente/modelo";
import { cargarTurnos, contextoEnPalabras, listarConversaciones, obtenerConversacion } from "@/lib/asistente/conversaciones";
import { versionVigente } from "@/lib/semantic/queries";
import type { VersionVigente } from "@/lib/semantic/contracts";
import { requerirAcceso } from "@/lib/auth/acceso";

/** Pregunta sugerida según desde qué bloque del dashboard se llegó (?sobre=serie|canal|rutas). */
const SOBRE: Record<string, (anio: number) => string> = {
  serie: (anio) => `¿Cómo viene la venta neta mes a mes en ${anio}?`,
  canal: () => "¿Dónde se concentra la variación por canal?",
  rutas: () => "¿Qué rutas explican la variación?",
};

const SUGERENCIAS: Sugerencia[] = [
  { categoria: "Variación", texto: "¿Dónde se concentra la variación del mes?", icono: "tendencia" },
  { categoria: "Clientes y facturas", texto: "¿Bajó el número de facturas o el ticket?", icono: "personas" },
  { categoria: "Producto", texto: "¿Qué productos cayeron más en Mayoreo?", icono: "caja" },
  { categoria: "Rutas", texto: "¿Qué rutas explican la variación?", icono: "mapa" },
];

/** La conversación del enlace (?c=id) con sus turnos; null si no existe, es de otro usuario o está archivada. */
async function conversacionDelEnlace(id: string, version: VersionVigente): Promise<ConversacionInicial | null> {
  const conversacion = await obtenerConversacion(id);
  if (!conversacion) return null;
  return { conversacion, contextoTxt: contextoEnPalabras(conversacion.contexto, version).texto, turnos: await cargarTurnos(id) };
}

export default async function Asistente(props: PageProps<"/asistente">) {
  const usuario = await requerirAcceso(); // el layout no se vuelve a ejecutar en cada navegación
  const version = await versionVigente();
  if (!version) {
    return <p className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">Todavía no hay una versión publicada.</p>;
  }
  const sp = await props.searchParams;
  const estado = leerParams(sp, version.metadatos.periodos);
  const cmp = periodoComparado(estado.periodo, estado.comparar);
  const c = typeof sp.c === "string" ? sp.c : undefined;
  // Si la lista o la conversación no cargan, el asistente sigue funcionando: se empieza una conversación nueva.
  const [conversaciones, abierta] = await Promise.all([
    listarConversaciones().catch((e) => { console.error("asistente:", e); return []; }),
    c ? conversacionDelEnlace(c, version).catch((e) => { console.error("asistente:", e); return null; }) : null,
  ]);
  // Con una conversación abierta no se reenvía la pregunta sugerida (?sobre=): ya se hizo al crearla.
  const sobre = !abierta && typeof sp.sobre === "string" ? SOBRE[sp.sobre]?.(estado.periodo.anio) : undefined;

  return (
    <Chat
      // Cada render del servidor es una navegación (p. ej. "Asistente de IA" en el menú estando en ?c=…): el chat
      // arranca de nuevo con lo que trae la URL en vez de conservar el estado de la conversación anterior.
      key={crypto.randomUUID()}
      nombre={usuario.nombre.split(" ")[0] || usuario.nombre}
      contexto={queryString(estado)}
      contextoTxt={`${capital(rango(estado.periodo, cmp))} · ${describirFiltros(estado.filtros, version.metadatos)}`}
      version={version.version}
      inicial={sobre}
      conModelo={configModelo() !== null}
      sugerencias={SUGERENCIAS}
      conversaciones={conversaciones}
      abierta={abierta}
      descartada={!!c && !abierta}
    />
  );
}
