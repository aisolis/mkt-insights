import "server-only";
import { cache } from "react";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { SIGNOS_BLOQUEO } from "./alcance";
import { sistema } from "./modelo";
import { normalizar } from "./texto";
import type { Contexto, ReglaAsistente } from "./tipos";

/**
 * Reglas del asistente (G8), administradas por un admin en /asistente/configuracion/reglas. Las tablas no tienen acceso para
 * anon/authenticated (0011_reglas_asistente.sql): se leen y cambian con service_role. Quien llama a las funciones
 * de administración ya verificó requerirAdmin(); reglasActivas() la llama el asistente, que ya verificó el acceso.
 */

export type TipoRegla = ReglaAsistente["tipo"];
export const TIPOS_REGLA = ["instruccion", "definicion", "bloqueo"] as const satisfies readonly TipoRegla[];
/** Igual que interno.tope_reglas_asistente(): cada regla alarga las instrucciones del modelo. */
export const TOPE_REGLAS_ACTIVAS = 30;
export const MAX_TERMINOS = 20;

/** Mismos signos que quita reglaBloqueo() de la pregunta: un término con ellos nunca coincidiría. */
const SIGNOS = SIGNOS_BLOQUEO;

/** Limpia los términos de un bloqueo: sin signos, espacios de más ni vacíos, y sin repetidos (sin tildes ni mayúsculas). */
export function normalizarTerminos(terminos: string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const t of terminos) {
    const limpio = t.replace(SIGNOS, " ").replace(/\s+/g, " ").trim();
    const clave = normalizar(limpio);
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(limpio);
  }
  return salida;
}

export const EntradaRegla = z.object({
  tipo: z.enum(TIPOS_REGLA, "Elige el tipo de regla."),
  // Una sola línea: el texto va como viñeta en las instrucciones y no puede imitar su estructura.
  texto: z.string().transform((s) => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(3, "Escribe la regla (al menos 3 caracteres).").max(500, "La regla no puede pasar de 500 caracteres.")),
  terminos: z.array(z.string()).default([]),
}).transform((r) => ({ ...r, terminos: r.tipo === "bloqueo" ? normalizarTerminos(r.terminos) : [] }))
  .superRefine((r, c) => {
    if (r.tipo !== "bloqueo") return;
    if (!r.terminos.length) c.addIssue({ code: "custom", message: "Un bloqueo necesita al menos una palabra o frase que lo active." });
    if (r.terminos.length > MAX_TERMINOS) c.addIssue({ code: "custom", message: `Un bloqueo admite hasta ${MAX_TERMINOS} palabras o frases.` });
    const mala = r.terminos.find((t) => t.length < 2 || t.length > 80);
    if (mala) c.addIssue({ code: "custom", message: `«${mala}»: cada palabra o frase debe tener entre 2 y 80 caracteres.` });
  });
export type EntradaRegla = z.input<typeof EntradaRegla>;

type FilaBD = { id: string; tipo: TipoRegla; texto: string; terminos: string[]; activa: boolean; creada_en: string; actualizada_en: string; creada_por: string | null; actualizada_por: string | null };

const aRegla = (f: Pick<FilaBD, "id" | "tipo" | "texto" | "terminos">): ReglaAsistente => ({ id: f.id, tipo: f.tipo, texto: f.texto, terminos: f.terminos });

/**
 * Reglas activas para el asistente, una vez por petición. Si la lectura falla se responde sin reglas (y queda en
 * el log): el asistente no se cae por una regla, y sus garantías fijas siguen en el código.
 */
export const reglasActivas = cache(async (): Promise<ReglaAsistente[]> => {
  try {
    const { data, error } = await createServiceClient().schema("ventas").from("regla_asistente")
      .select("id, tipo, texto, terminos").eq("activa", true).order("creada_en").order("id").returns<FilaBD[]>();
    if (error) throw error;
    return data.map(aRegla);
  } catch (e) {
    console.error("asistente: no se pudieron leer las reglas; se responde sin ellas", e);
    return [];
  }
});

// Administración ---------------------------------------------------------------------------------------------------

export type FilaRegla = ReglaAsistente & {
  activa: boolean; creadaEn: string; actualizadaEn: string; creadaPor: string | null; actualizadaPor: string | null;
};
export type AccionCambio = "creada" | "editada" | "activada" | "desactivada" | "eliminada";
type FotoRegla = { tipo: TipoRegla; texto: string; terminos: string[]; activa: boolean };
export type CambioRegla = { id: number; reglaId: string; accion: AccionCambio; antes: FotoRegla | null; despues: FotoRegla | null; usuario: string | null; creadoEn: string };

/** Nombre de cada usuario según su perfil (las reglas guardan el id de auth.users). */
async function nombres(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map();
  const { data } = await createServiceClient().from("perfil").select("user_id, nombre").in("user_id", unicos).returns<{ user_id: string; nombre: string }[]>();
  return new Map((data ?? []).map((p) => [p.user_id, p.nombre]));
}

/** Todas las reglas (activas e inactivas), en el orden en que se crearon. */
export async function listarReglas(): Promise<FilaRegla[]> {
  const { data, error } = await createServiceClient().schema("ventas").from("regla_asistente")
    .select("id, tipo, texto, terminos, activa, creada_en, actualizada_en, creada_por, actualizada_por").order("creada_en").order("id").returns<FilaBD[]>();
  if (error) throw new Error(`reglas del asistente: ${error.message}`);
  const n = await nombres(data.flatMap((f) => [f.creada_por, f.actualizada_por]));
  return data.map((f) => ({
    ...aRegla(f), activa: f.activa, creadaEn: f.creada_en, actualizadaEn: f.actualizada_en,
    creadaPor: f.creada_por ? n.get(f.creada_por) ?? "usuario sin perfil" : null,
    actualizadaPor: f.actualizada_por ? n.get(f.actualizada_por) ?? "usuario sin perfil" : null,
  }));
}

/** Últimos cambios de la bitácora, del más reciente al más antiguo. */
export async function ultimosCambios(limite = 10): Promise<CambioRegla[]> {
  const { data, error } = await createServiceClient().schema("ventas").from("regla_asistente_cambio")
    .select("id, regla_id, accion, antes, despues, usuario_id, creado_en").order("id", { ascending: false }).limit(limite)
    .returns<{ id: number; regla_id: string; accion: AccionCambio; antes: FotoRegla | null; despues: FotoRegla | null; usuario_id: string | null; creado_en: string }[]>();
  if (error) throw new Error(`bitácora de reglas: ${error.message}`);
  const n = await nombres(data.map((c) => c.usuario_id));
  return data.map((c) => ({
    id: c.id, reglaId: c.regla_id, accion: c.accion, antes: c.antes, despues: c.despues, creadoEn: c.creado_en,
    usuario: c.usuario_id ? n.get(c.usuario_id) ?? "usuario sin perfil" : null,
  }));
}

export type ResultadoRegla = { error?: string; id?: string };

/** Los errores que lanza la base con `raise exception` ya vienen redactados para la persona (tope, regla borrada). */
function errorBD(e: { code?: string; message: string }, accion: string): ResultadoRegla {
  return { error: e.code === "P0001" ? e.message : `No se pudo ${accion} la regla (${e.message}).` };
}

function validar(entrada: EntradaRegla): { datos: z.output<typeof EntradaRegla> } | { error: string } {
  const r = EntradaRegla.safeParse(entrada);
  return r.success ? { datos: r.data } : { error: r.error.issues[0].message };
}

/** Crea una regla activa y deja su fila en la bitácora (misma transacción, en la base). */
export async function crearRegla(entrada: EntradaRegla, usuarioId: string | null): Promise<ResultadoRegla> {
  const v = validar(entrada);
  if ("error" in v) return v;
  const { data, error } = await createServiceClient().schema("ventas").rpc("guardar_regla_asistente", {
    p_id: null, p_tipo: v.datos.tipo, p_texto: v.datos.texto, p_terminos: v.datos.terminos, p_usuario: usuarioId,
  });
  if (error) return errorBD(error, "guardar");
  return { id: (data as { id: string }).id };
}

export async function editarRegla(id: string, entrada: EntradaRegla, usuarioId: string | null): Promise<ResultadoRegla> {
  const v = validar(entrada);
  if ("error" in v) return v;
  const { error } = await createServiceClient().schema("ventas").rpc("guardar_regla_asistente", {
    p_id: id, p_tipo: v.datos.tipo, p_texto: v.datos.texto, p_terminos: v.datos.terminos, p_usuario: usuarioId,
  });
  return error ? errorBD(error, "guardar") : { id };
}

/** Activa o desactiva. Activar respeta el tope de reglas activas. Si ya estaba así, no deja fila en la bitácora. */
export async function activarRegla(id: string, activa: boolean, usuarioId: string | null): Promise<ResultadoRegla> {
  const { error } = await createServiceClient().schema("ventas").rpc("activar_regla_asistente", { p_id: id, p_activa: activa, p_usuario: usuarioId });
  return error ? errorBD(error, activa ? "activar" : "desactivar") : { id };
}

/** Elimina la regla; su historia queda en la bitácora con el texto que tenía. */
export async function eliminarRegla(id: string, usuarioId: string | null): Promise<ResultadoRegla> {
  const { error } = await createServiceClient().schema("ventas").rpc("eliminar_regla_asistente", { p_id: id, p_usuario: usuarioId });
  return error ? errorBD(error, "eliminar") : { id };
}

// Vista previa -----------------------------------------------------------------------------------------------------

/** Contexto mínimo para sistema(): solo importa la diferencia que agregan las reglas, no estos datos. */
const CTX_VISTA: Contexto = {
  fuente: {} as Contexto["fuente"],
  version: {
    version: 0, fecha_corte: "2026-01-31", conciliada_bi: false, publicado_en: "2026-01-31T00:00:00Z", archivo: "",
    metadatos: { periodos: [{ anio: 2026, mes: 1, dias: 1, ultimo_dia: "2026-01-31", cerrado: true }], canal: [], ruta: [], marca: [], producto: [], rutas_total: 0 },
  },
  estado: { periodo: { anio: 2026, mes: 1 }, comparar: "anterior", filtros: {} },
};

/**
 * Las líneas que las reglas agregan a las instrucciones de sistema, tal como las recibe el modelo. Sale de
 * sistema() mismo (con y sin reglas), así que la vista previa no puede quedar desalineada con lo que se envía.
 * Los bloqueos no aparecen: no van al modelo, los aplica el código antes.
 */
export function seccionReglas(reglas: ReglaAsistente[]): string[] {
  const base = sistema(CTX_VISTA).split("\n");
  const con = sistema({ ...CTX_VISTA, reglas }).split("\n");
  let i = 0;
  while (i < base.length && base[i] === con[i]) i++;
  return con.slice(i, i + con.length - base.length);
}
