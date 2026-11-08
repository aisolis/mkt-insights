import "server-only";
import { cache } from "react";
import { z } from "zod";
import { leerParams } from "@/lib/dashboard/params";
import { buscarDocumentos } from "@/lib/conocimiento/servidor";
import * as fuente from "@/lib/semantic/queries";
import { createServiceClient } from "@/lib/supabase/server";
import {
  configModelo, decidirModelo, modeloPermitido, modeloPorDefecto, modelosPermitidos, usoVacio, type ConfigModelo, type Decision, type Uso,
} from "./modelo";
import { usd } from "./dinero";
import { reglasActivas } from "./reglas-servidor";
import { responder } from "./responder";

/**
 * Configuración del asistente (G8, 0013_config_asistente.sql): si se usa IA, con qué modelo de OpenRouter y
 * (G9, 0017_asistente_uso.sql) el tope de gasto mensual. Se lee y se cambia con service_role; quien cambia ya
 * verificó requerirAdmin(). La llave queda en el entorno.
 */

export type Config = { usarIa: boolean; modelo: string | null; topeUsd: number | null; actualizadaEn: string | null; actualizadaPor: string | null };
const POR_DEFECTO: Config = { usarIa: true, modelo: null, topeUsd: null, actualizadaEn: null, actualizadaPor: null };

const svc = () => createServiceClient().schema("ventas");

async function nombre(id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await createServiceClient().from("perfil").select("nombre").eq("user_id", id).maybeSingle();
  return (data?.nombre as string | undefined) ?? null;
}

/** La configuración guardada. Si no se puede leer, la de fábrica: el asistente nunca se cae por esto. */
export const leerConfig = cache(async (): Promise<Config> => {
  try {
    const { data, error } = await svc().from("config_asistente").select("usar_ia, modelo, tope_mensual_usd, actualizada_en, actualizada_por").maybeSingle();
    if (error) throw error;
    if (!data) return POR_DEFECTO;
    return {
      usarIa: data.usar_ia, modelo: data.modelo, topeUsd: data.tope_mensual_usd === null ? null : Number(data.tope_mensual_usd),
      actualizadaEn: data.actualizada_en, actualizadaPor: await nombre(data.actualizada_por),
    };
  } catch (e) {
    console.error("asistente: no se pudo leer la configuración; se usa la de fábrica", e);
    return POR_DEFECTO;
  }
});

/** El modelo configurado (null = análisis automático por reglas), sin mirar el tope ni la lista de permitidos. */
export async function modeloActivo(): Promise<ConfigModelo | null> {
  return configModelo(await leerConfig());
}

// Gasto del mes y tope (G9) ---------------------------------------------------------------------------------------

export type GastoMes = { desde: string; totalUsd: number; preguntasUsd: number; preguntas: number; pruebasUsd: number; pruebas: number };

/** Gasto de OpenRouter del mes en curso (hora de Honduras): preguntas + pruebas de modelo. */
export async function gastoMes(): Promise<GastoMes> {
  const { data, error } = await svc().rpc("gasto_asistente_mes");
  if (error) throw new Error(`gasto del mes: ${error.message}`);
  const g = data as Record<string, string | number>;
  return {
    desde: String(g.desde), totalUsd: Number(g.total_usd), preguntasUsd: Number(g.preguntas_usd), preguntas: Number(g.preguntas),
    pruebasUsd: Number(g.pruebas_usd), pruebas: Number(g.pruebas),
  };
}

/**
 * Con qué responde la próxima pregunta: el modelo configurado, salvo que no esté en la lista de permitidos o que
 * el gasto del mes ya llegó al tope (entonces análisis automático con aviso). Si el gasto no se puede leer, se
 * responde con el modelo: el tope es un freno de costos, no una razón para dejar de responder.
 */
export async function modeloParaPregunta(): Promise<Decision & { topeUsd: number | null }> {
  const config = await leerConfig();
  const cfg = configModelo(config);
  let gastoUsd: number | null = null;
  if (cfg && config.topeUsd !== null) {
    gastoUsd = await gastoMes().then((g) => g.totalUsd).catch((e) => {
      console.error("asistente: no se pudo leer el gasto del mes", e);
      return null;
    });
  }
  return { ...decidirModelo(cfg, { permitidos: modelosPermitidos(), topeUsd: config.topeUsd, gastoUsd }), topeUsd: config.topeUsd };
}

export type ColumnasUso = { tokens_entrada: number | null; tokens_salida: number | null; costo_usd: number | null; costo_estimado: boolean };

/**
 * Columnas de uso para la bitácora. Los tokens de rondas sin costo informado se estiman con los precios del
 * catálogo (costo_estimado). Sin llamadas a OpenRouter, o si ninguna informó uso: null.
 */
export async function columnasUso(uso: Uso, modelo: string | null): Promise<ColumnasUso> {
  if (!uso.llamadas) return { tokens_entrada: null, tokens_salida: null, costo_usd: null, costo_estimado: false };
  let costo = uso.costoUsd;
  let estimado = false;
  if (modelo && (uso.sinCosto.entrada || uso.sinCosto.salida)) {
    const m = (await catalogoCompleto()).modelos.find((x) => x.id === modelo);
    if (m && m.entrada !== null && m.salida !== null) {
      costo += (uso.sinCosto.entrada * m.entrada + uso.sinCosto.salida * m.salida) / 1e6;
      estimado = true;
    }
  }
  const sinDatos = uso.sinUso === uso.llamadas;
  return {
    tokens_entrada: sinDatos ? null : uso.tokensEntrada, tokens_salida: sinDatos ? null : uso.tokensSalida,
    costo_usd: sinDatos ? null : Number(costo.toFixed(8)), costo_estimado: estimado,
  };
}

/** Tope en dólares: mayor que cero, con centavos; null = sin tope. */
export const EntradaTope = z.number().positive().max(100_000).nullable();

/** Guarda el tope de gasto mensual (null = sin tope). Queda en el historial de cambios. */
export async function guardarTope(tope: number | null, usuarioId: string | null): Promise<{ error?: string }> {
  const v = EntradaTope.safeParse(tope);
  if (!v.success) return { error: "El tope debe ser un monto en dólares mayor que cero (o vacío para no tener tope)." };
  const { error } = await svc().rpc("guardar_tope_asistente", { p_tope: v.data, p_usuario: usuarioId });
  if (error) {
    console.error("asistente: no se pudo guardar el tope", error);
    return { error: "No se pudo guardar el tope." };
  }
  return {};
}

// Catálogo de OpenRouter ------------------------------------------------------------------------------------------

export type ModeloCatalogo = {
  id: string; nombre: string; proveedor: string; contexto: number; entrada: number | null; salida: number | null; creado: number; gratis: boolean;
};

const ModeloOR = z.object({
  id: z.string(), name: z.string(), created: z.number().optional(), context_length: z.number().nullable().optional(),
  pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).partial().optional(),
  supported_parameters: z.array(z.string()).optional(),
});

let memo: { en: number; modelos: ModeloCatalogo[] } | null = null;
const VIGENCIA_MS = 60 * 60 * 1000;
const porMillon = (s?: string) => (s === undefined || s === "" || Number.isNaN(Number(s)) ? null : Number(s) * 1e6);

/**
 * Modelos de OpenRouter que aceptan herramientas (el asistente las necesita para consultar los datos), sin las
 * variantes por lotes y, si el servidor tiene lista de permitidos (OPENROUTER_MODELOS_PERMITIDOS), solo esos.
 */
export async function catalogoModelos(): Promise<{ modelos: ModeloCatalogo[]; error?: string }> {
  const r = await catalogoCompleto();
  const permitidos = modelosPermitidos();
  return permitidos ? { ...r, modelos: r.modelos.filter((m) => modeloPermitido(m.id, permitidos)) } : r;
}

/** Todo el catálogo con herramientas (también sirve para precios). Se pide en vivo y se guarda una hora en memoria (~1 MB). */
async function catalogoCompleto(): Promise<{ modelos: ModeloCatalogo[]; error?: string }> {
  if (memo && Date.now() - memo.en < VIGENCIA_MS) return { modelos: memo.modelos };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const json = (await res.json()) as { data?: unknown[] };
    const modelos = (json.data ?? []).flatMap((m) => {
      const p = ModeloOR.safeParse(m);
      if (!p.success || !p.data.supported_parameters?.includes("tools") || p.data.id.endsWith(":batch")) return [];
      const d = p.data;
      const entrada = porMillon(d.pricing?.prompt), salida = porMillon(d.pricing?.completion);
      return [{
        id: d.id, nombre: d.name, proveedor: d.id.split("/")[0], contexto: d.context_length ?? 0, entrada, salida,
        creado: d.created ?? 0, gratis: d.id.endsWith(":free") || (entrada === 0 && salida === 0),
      }];
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    memo = { en: Date.now(), modelos };
    return { modelos };
  } catch (e) {
    console.error("asistente: no se pudo leer el catálogo de OpenRouter", e);
    return { modelos: memo?.modelos ?? [], error: "No se pudo leer el catálogo de modelos de OpenRouter. Intenta de nuevo en un momento." };
  }
}

// Cambios ---------------------------------------------------------------------------------------------------------

export const EntradaConfig = z.object({
  usarIa: z.boolean(),
  modelo: z.string().trim().max(120).nullable().transform((m) => m || null),
});
export type EntradaConfig = z.input<typeof EntradaConfig>;

/**
 * Guarda la configuración. Un modelo elegido debe existir hoy en el catálogo, aceptar herramientas y, si hay lista
 * de permitidos, estar en ella (con IA, también el por defecto del servidor).
 */
export async function guardarConfig(entrada: EntradaConfig, usuarioId: string | null): Promise<{ error?: string }> {
  const v = EntradaConfig.safeParse(entrada);
  if (!v.success) return { error: "Configuración no válida." };
  const { usarIa, modelo } = v.data;
  if (modelo && !modeloPermitido(modelo)) return { error: `«${modelo}» no está en la lista de modelos permitidos del servidor.` };
  if (!modelo && usarIa && !modeloPermitido(modeloPorDefecto()))
    return { error: `El modelo por defecto del servidor (${modeloPorDefecto()}) no está en la lista de permitidos: elige uno de la lista.` };
  if (modelo) {
    const { modelos, error } = await catalogoModelos();
    if (error && !modelos.length) return { error };
    if (!modelos.some((m) => m.id === modelo)) return { error: `«${modelo}» no está en el catálogo de OpenRouter o no acepta herramientas.` };
  }
  const { error } = await svc().rpc("guardar_config_asistente", { p_usar_ia: usarIa, p_modelo: modelo, p_usuario: usuarioId });
  if (error) {
    console.error("asistente: no se pudo guardar la configuración", error);
    return { error: "No se pudo guardar la configuración." };
  }
  return {};
}

/** Foto de la configuración en un cambio. tope_mensual_usd no está en los cambios anteriores a G9. */
export type FotoConfig = { usar_ia: boolean; modelo: string | null; tope_mensual_usd?: number | null };
export type CambioConfig = { creadoEn: string; usuario: string | null; antes: FotoConfig; despues: FotoConfig };

export async function cambiosConfig(limite = 10): Promise<CambioConfig[]> {
  const { data, error } = await svc().from("config_asistente_cambio").select("antes, despues, usuario_id, creado_en")
    .order("creado_en", { ascending: false }).limit(limite);
  if (error) throw new Error(`configuración: ${error.message}`);
  const ids = [...new Set((data ?? []).map((c) => c.usuario_id).filter(Boolean))] as string[];
  const { data: perfiles } = ids.length
    ? await createServiceClient().from("perfil").select("user_id, nombre").in("user_id", ids)
    : { data: [] as { user_id: string; nombre: string }[] };
  const nombres = new Map((perfiles ?? []).map((p) => [p.user_id as string, p.nombre as string]));
  return (data ?? []).map((c) => ({ creadoEn: c.creado_en, usuario: (c.usuario_id && nombres.get(c.usuario_id)) || null, antes: c.antes, despues: c.despues }));
}

// Prueba ----------------------------------------------------------------------------------------------------------

export type ResultadoPrueba = {
  modelo: string; segundos: number; estado: string; texto: string; verificada: boolean; herramientas: string[]; aviso: string | null;
  /** Costo de la prueba en dólares (null si OpenRouter no lo informó) y si se estimó con los precios del catálogo. */
  costoUsd: number | null; costoEstimado: boolean; tokens: number | null;
};

/**
 * Responde una pregunta con el modelo indicado sin guardarlo ni registrarlo en la bitácora: sirve para comparar
 * modelos antes de cambiar. Usa la versión vigente, el periodo por defecto, las reglas activas y los documentos.
 * Gasta tokens de OpenRouter: respeta la lista de permitidos y el tope del mes, y su costo cuenta para el tope.
 */
export async function probarModelo(modelo: string, pregunta: string, usuarioId: string | null = null): Promise<ResultadoPrueba | { error: string }> {
  const cfg = configModelo({ usarIa: true, modelo });
  if (!cfg) return { error: "No hay llave de OpenRouter configurada en el servidor." };
  if (!modeloPermitido(modelo)) return { error: `«${modelo}» no está en la lista de modelos permitidos del servidor.` };
  const { topeUsd } = await leerConfig();
  if (topeUsd !== null) {
    const gasto = await gastoMes().catch(() => null);
    if (gasto && gasto.totalUsd >= topeUsd)
      return { error: `Se llegó al tope de gasto de IA del mes (${usd(gasto.totalUsd)} de ${usd(topeUsd)}). Sube el tope para seguir probando.` };
  }
  const version = await fuente.versionVigente();
  if (!version) return { error: "Todavía no hay una versión publicada." };
  const inicio = Date.now();
  const uso = usoVacio();
  try {
    const r = await responder(pregunta, [], {
      fuente, version, estado: leerParams({}, version.metadatos.periodos), documentos: buscarDocumentos, reglas: await reglasActivas(),
    }, cfg, { uso });
    const aviso = r.evidencia.advertencias.find((a) => /modelo/i.test(a)) ?? null;
    const c = await registrarPrueba(modelo, uso, usuarioId);
    return {
      modelo, segundos: (Date.now() - inicio) / 1000, estado: r.estado, texto: r.texto,
      verificada: r.modo === "modelo" && !aviso, herramientas: r.consultas.map((x) => x.herramienta), aviso,
      costoUsd: c.costo_usd, costoEstimado: c.costo_estimado,
      tokens: c.tokens_entrada === null && c.tokens_salida === null ? null : (c.tokens_entrada ?? 0) + (c.tokens_salida ?? 0),
    };
  } catch (e) {
    console.error("asistente: prueba de modelo", e);
    await registrarPrueba(modelo, uso, usuarioId);
    return { error: "La prueba falló. Revisa que el modelo esté disponible en OpenRouter." };
  }
}

/** Deja el costo de una prueba (cuenta para el tope). Si no se puede guardar, la prueba igual se muestra. */
async function registrarPrueba(modelo: string, uso: Uso, usuarioId: string | null): Promise<ColumnasUso> {
  const c = await columnasUso(uso, modelo);
  if (uso.llamadas) {
    const { error } = await svc().from("prueba_modelo").insert({ modelo, usuario_id: usuarioId, ...c });
    if (error) console.error("asistente: no se pudo registrar el costo de la prueba", error.message);
  }
  return c;
}
