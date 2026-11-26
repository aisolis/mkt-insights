import { Chat, type ConversacionInicial, type Sugerencia } from "@/components/asistente/chat";
import { leerParams, periodoComparado, queryString } from "@/lib/dashboard/params";
import { describirFiltros, rango } from "@/lib/asistente/texto";
import { capital } from "@/lib/format";
import { listarAdjuntos } from "@/lib/asistente/adjuntos-servidor";
import { modeloParaPregunta } from "@/lib/asistente/config-servidor";
import { presupuestoDe } from "@/lib/asistente/presupuesto-servidor";
import { cargarTurnos, contextoEnPalabras, listarConversaciones, obtenerConversacion } from "@/lib/asistente/conversaciones";
import { versionVigente } from "@/lib/semantic/queries";
import type { VersionVigente } from "@/lib/semantic/contracts";
import { requerirAcceso } from "@/lib/auth/acceso";

/** Pregunta sugerida según desde qué bloque del dashboard se llegó (?sobre=serie|canal|rutas). */
const SOBRE: Record<string, (anio: number) => string> = {
  serie: (anio) => `¿Cómo viene la venta neta mes a mes en ${anio}?`,
  canal: () => "¿Dónde se concentra la variación por canal?",
  rutas: () => "¿Qué rutas explican la variación?",
  acumulado: (anio) => `¿Cómo vamos en lo que va del año ${anio}?`,
  precio: () => "¿La variación fue por precio, volumen o mezcla?",
  atipicas: () => "¿Qué rutas se salieron de lo normal este mes?",
};

const SUGERENCIAS: Sugerencia[] = [
  { categoria: "Variación", texto: "¿Dónde se concentra la variación del mes?", icono: "tendencia" },
  { categoria: "Clientes y facturas", texto: "¿Bajó el número de facturas o el ticket?", icono: "personas" },
  { categoria: "Producto", texto: "¿Qué productos cayeron más en Mayoreo?", icono: "caja" },
  { categoria: "Rutas", texto: "¿Qué rutas explican la variación?", icono: "mapa" },
];

/** La conversación del enlace (?c=id) con sus turnos; null si no existe, es de otro usuario o está archivada. */
async function conversacionDelEnlace(id: string, version: VersionVigente, usuarioId: string): Promise<ConversacionInicial | null> {
  const conversacion = await obtenerConversacion(id);
  if (!conversacion) return null;
  // Si los adjuntos no cargan, la conversación se abre igual (sin ellos en pantalla).
  const [turnos, adjuntos] = await Promise.all([
    cargarTurnos(id),
    listarAdjuntos(id, usuarioId).catch((e) => { console.error("asistente (adjuntos):", e); return []; }),
  ]);
  return { conversacion, contextoTxt: contextoEnPalabras(conversacion.contexto, version).texto, turnos, adjuntos };
}

export default async function Asistente(props: PageProps<"/asistente">) {
  // La versión sale junto con el acceso (comparten la sesión verificada); se usa solo si el acceso pasó.
  const versionP = versionVigente();
  versionP.catch(() => {}); // si requerirAcceso() redirige, que no quede como rechazo sin manejar
  const usuario = await requerirAcceso(); // el layout no se vuelve a ejecutar en cada navegación
  // Lo que no depende de la versión arranca ya (antes iba después, en serie): la lista y el modelo del asistente.
  const conversacionesP = listarConversaciones().catch((e) => { console.error("asistente:", e); return []; });
  // La decisión global (tope de la app, modelo permitido) y el presupuesto de IA de la persona.
  const presupuestoP = presupuestoDe(usuario.id);
  const modeloP = modeloParaPregunta();
  modeloP.catch(() => {}); // sin versión publicada no se espera: que no quede como rechazo sin manejar
  const [version, sp] = await Promise.all([versionP, props.searchParams]);
  if (!version) {
    return <p className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">Todavía no hay una versión publicada.</p>;
  }
  const estado = leerParams(sp, version.metadatos.periodos);
  const cmp = periodoComparado(estado.periodo, estado.comparar);
  const c = typeof sp.c === "string" ? sp.c : undefined;
  // Si la lista o la conversación no cargan, el asistente sigue funcionando: se empieza una conversación nueva.
  const [conversaciones, abierta, modeloGlobal, presupuesto] = await Promise.all([
    conversacionesP,
    c ? conversacionDelEnlace(c, version, usuario.id).catch((e) => { console.error("asistente:", e); return null; }) : null,
    modeloP,
    presupuestoP, // si no se puede leer, cuenta como sin límite
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
      // Con el tope de gasto alcanzado o un modelo no permitido responde el análisis automático (G9).
      // Sin presupuesto de IA también responde el automático; el chat ofrece pedir una ampliación.
      conModelo={modeloGlobal.modelo !== null && !presupuesto.agotado}
      conIa={modeloGlobal.modelo !== null}
      presupuesto={presupuesto}
      sugerencias={SUGERENCIAS}
      conversaciones={conversaciones}
      abierta={abierta}
      descartada={!!c && !abierta}
    />
  );
}
