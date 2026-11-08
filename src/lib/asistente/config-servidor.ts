import "server-only";
import { cache } from "react";
import { z } from "zod";
import { leerParams } from "@/lib/dashboard/params";
import { buscarDocumentos } from "@/lib/conocimiento/servidor";
import * as fuente from "@/lib/semantic/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { configModelo, type ConfigModelo } from "./modelo";
import { reglasActivas } from "./reglas-servidor";
import { responder } from "./responder";

/**
 * Configuración del asistente (G8, 0013_config_asistente.sql): si se usa IA y con qué modelo de OpenRouter.
 * Se lee y se cambia con service_role; quien cambia ya verificó requerirAdmin(). La llave queda en el entorno.
 */

export type Config = { usarIa: boolean; modelo: string | null; actualizadaEn: string | null; actualizadaPor: string | null };
const POR_DEFECTO: Config = { usarIa: true, modelo: null, actualizadaEn: null, actualizadaPor: null };

const svc = () => createServiceClient().schema("ventas");

async function nombre(id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await createServiceClient().from("perfil").select("nombre").eq("user_id", id).maybeSingle();
  return (data?.nombre as string | undefined) ?? null;
}

/** La configuración guardada. Si no se puede leer, la de fábrica: el asistente nunca se cae por esto. */
export const leerConfig = cache(async (): Promise<Config> => {
  try {
    const { data, error } = await svc().from("config_asistente").select("usar_ia, modelo, actualizada_en, actualizada_por").maybeSingle();
    if (error) throw error;
    if (!data) return POR_DEFECTO;
    return { usarIa: data.usar_ia, modelo: data.modelo, actualizadaEn: data.actualizada_en, actualizadaPor: await nombre(data.actualizada_por) };
  } catch (e) {
    console.error("asistente: no se pudo leer la configuración; se usa la de fábrica", e);
    return POR_DEFECTO;
  }
});

/** El modelo con que responde el asistente ahora (null = análisis automático por reglas). */
export async function modeloActivo(): Promise<ConfigModelo | null> {
  return configModelo(await leerConfig());
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
 * variantes por lotes. Se pide en vivo y se guarda una hora en memoria (la lista pesa ~1 MB).
 */
export async function catalogoModelos(): Promise<{ modelos: ModeloCatalogo[]; error?: string }> {
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

/** Guarda la configuración. Un modelo elegido debe existir hoy en el catálogo y aceptar herramientas. */
export async function guardarConfig(entrada: EntradaConfig, usuarioId: string | null): Promise<{ error?: string }> {
  const v = EntradaConfig.safeParse(entrada);
  if (!v.success) return { error: "Configuración no válida." };
  const { usarIa, modelo } = v.data;
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

export type CambioConfig = { creadoEn: string; usuario: string | null; antes: { usar_ia: boolean; modelo: string | null }; despues: { usar_ia: boolean; modelo: string | null } };

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
};

/**
 * Responde una pregunta con el modelo indicado sin guardarlo ni registrarlo en la bitácora: sirve para comparar
 * modelos antes de cambiar. Usa la versión vigente, el periodo por defecto, las reglas activas y los documentos.
 * Gasta tokens de OpenRouter.
 */
export async function probarModelo(modelo: string, pregunta: string): Promise<ResultadoPrueba | { error: string }> {
  const cfg = configModelo({ usarIa: true, modelo });
  if (!cfg) return { error: "No hay llave de OpenRouter configurada en el servidor." };
  const version = await fuente.versionVigente();
  if (!version) return { error: "Todavía no hay una versión publicada." };
  const inicio = Date.now();
  try {
    const r = await responder(pregunta, [], {
      fuente, version, estado: leerParams({}, version.metadatos.periodos), documentos: buscarDocumentos, reglas: await reglasActivas(),
    }, cfg);
    const aviso = r.evidencia.advertencias.find((a) => /modelo/i.test(a)) ?? null;
    return {
      modelo, segundos: (Date.now() - inicio) / 1000, estado: r.estado, texto: r.texto,
      verificada: r.modo === "modelo" && !aviso, herramientas: r.consultas.map((c) => c.herramienta), aviso,
    };
  } catch (e) {
    console.error("asistente: prueba de modelo", e);
    return { error: "La prueba falló. Revisa que el modelo esté disponible en OpenRouter." };
  }
}
