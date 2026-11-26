/**
 * G8: configuración del asistente (modelo de IA). Unitarias: qué modelo se usa según la configuración y el
 * entorno, y el catálogo de OpenRouter (con fetch simulado). Integración contra el Supabase local
 * (0013_config_asistente.sql): guardar, no escribir si no cambió y bitácora de cambios. Deja la configuración
 * como estaba. La parte con base se salta si no hay service_role.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { configModelo, MODELO_FABRICA, modeloPorDefecto } from "@/lib/asistente/modelo";

vi.mock("server-only", () => ({}));
const { catalogoModelos, guardarConfig, leerConfig } = await import("@/lib/asistente/config-servidor");

const CATALOGO = {
  data: [
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", created: 2, context_length: 1048576, pricing: { prompt: "0.00000005", completion: "0.00000057" }, supported_parameters: ["tools", "temperature"] },
    { id: "deepseek/deepseek-v4.1-flash:batch", name: "DeepSeek V4.1 Flash (batch)", pricing: { prompt: "0.00000001", completion: "0.0000002" }, supported_parameters: ["tools"] },
    { id: "acme/sin-herramientas", name: "Sin herramientas", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["temperature"] },
    { id: "acme/modelo-x:free", name: "Modelo X (free)", context_length: 32000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
  ],
};

/** Simula solo la llamada al catálogo de OpenRouter; el resto (Supabase) va a la red de verdad. */
const fetchReal = globalThis.fetch;
const simularCatalogo = () => vi.spyOn(globalThis, "fetch").mockImplementation((entrada, init) =>
  String(entrada instanceof Request ? entrada.url : entrada).startsWith("https://openrouter.ai/")
    ? Promise.resolve(new Response(JSON.stringify(CATALOGO)))
    : fetchReal(entrada, init));

describe("configModelo", () => {
  const llave = process.env.OPENROUTER_API_KEY;
  const modeloEnv = process.env.OPENROUTER_MODEL;
  afterEach(() => {
    process.env.OPENROUTER_API_KEY = llave;
    process.env.OPENROUTER_MODEL = modeloEnv;
  });

  it("sin llave no hay modelo, se elija lo que se elija", () => {
    process.env.OPENROUTER_API_KEY = "";
    expect(configModelo({ usarIa: true, modelo: "acme/x" })).toBeNull();
  });

  it("la configuración puede apagar la IA o elegir modelo; si no elige, manda el entorno y luego el de fábrica", () => {
    process.env.OPENROUTER_API_KEY = "llave-de-prueba";
    expect(configModelo({ usarIa: false, modelo: "acme/x" })).toBeNull();
    expect(configModelo({ usarIa: true, modelo: "acme/x" })?.modelo).toBe("acme/x");
    process.env.OPENROUTER_MODEL = "acme/del-entorno";
    expect(configModelo({ usarIa: true, modelo: null })?.modelo).toBe("acme/del-entorno");
    expect(configModelo()?.modelo).toBe("acme/del-entorno");
    process.env.OPENROUTER_MODEL = "";
    expect(modeloPorDefecto()).toBe(MODELO_FABRICA);
  });
});

describe("catalogoModelos", () => {
  it("deja solo modelos con herramientas, sin variantes por lotes, con precio por millón", async () => {
    const f = simularCatalogo();
    const { modelos } = await catalogoModelos();
    f.mockRestore();
    expect(modelos.map((m) => m.id)).toEqual(["deepseek/deepseek-v4.1-flash", "acme/modelo-x:free"]);
    expect(modelos[0]).toMatchObject({ proveedor: "deepseek", contexto: 1048576 });
    expect(modelos[0].entrada).toBeCloseTo(0.05);
    expect(modelos[0].salida).toBeCloseTo(0.57);
    expect(modelos[1].gratis).toBe(true);
  });
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !service)("configuración en la base", () => {
  let svc: SupabaseClient;
  let original: { usar_ia: boolean; modelo: string | null };
  let desde: string;

  beforeAll(async () => {
    svc = createClient(url!, service!, { auth: { persistSession: false } });
    const { data, error } = await svc.schema("ventas").from("config_asistente").select("usar_ia, modelo").single();
    if (error) throw error;
    original = data;
    desde = new Date().toISOString();
  });

  afterAll(async () => {
    if (!svc) return;
    await svc.schema("ventas").from("config_asistente").update({ usar_ia: original.usar_ia, modelo: original.modelo }).eq("id", true);
    await svc.schema("ventas").from("config_asistente_cambio").delete().gte("creado_en", desde);
  });

  it("guarda un modelo del catálogo, registra el cambio y no escribe si no cambió", async () => {
    // El catálogo ya quedó en memoria con la prueba anterior; se simula por si corre sola.
    const f = simularCatalogo();
    const otro = original.modelo === "acme/modelo-x:free" ? "deepseek/deepseek-v4.1-flash" : "acme/modelo-x:free";
    expect(await guardarConfig({ usarIa: true, modelo: otro }, null)).toEqual({});
    expect(await guardarConfig({ usarIa: true, modelo: otro }, null)).toEqual({});
    expect(await guardarConfig({ usarIa: true, modelo: "acme/sin-herramientas" }, null)).toMatchObject({ error: expect.stringMatching(/no está en el catálogo/) });
    f.mockRestore();

    const { data } = await svc.schema("ventas").from("config_asistente").select("usar_ia, modelo").single();
    expect(data).toEqual({ usar_ia: true, modelo: otro });
    const cambios = await svc.schema("ventas").from("config_asistente_cambio").select("antes, despues").gte("creado_en", desde);
    expect(cambios.data).toHaveLength(1);
    // Desde G9 (0017) la foto del cambio también lleva el tope de gasto mensual y, desde 0032, el presupuesto general
    // por persona (su valor lo cambia otra prueba mientras corre esta: solo se comprueba que viene).
    expect(cambios.data![0].despues).toMatchObject({ usar_ia: true, modelo: otro, tope_mensual_usd: null });
    expect(Object.keys(cambios.data![0].despues).sort()).toEqual(["modelo", "presupuesto_usuario_usd", "tope_mensual_usd", "usar_ia"]);
  });

  it("apagar la IA conserva el modelo elegido", async () => {
    const antes = (await svc.schema("ventas").from("config_asistente").select("modelo").single()).data!.modelo;
    expect(await guardarConfig({ usarIa: false, modelo: antes }, null)).toEqual({});
    expect(await leerConfig()).toMatchObject({ usarIa: false, modelo: antes });
  });
});
