/**
 * G9: uso del asistente. Unitarias: tokens y costo sumados en todas las rondas de herramientas (fetch simulado),
 * tope de gasto que pasa a modo determinista con aviso, lista de modelos permitidos y costo estimado con el
 * catálogo. Integración contra el Supabase local (0017_asistente_uso.sql): valoraciones e informe solo del dueño
 * del turno, gasto del mes y tope con su historial. Crea usuarios @bia.test desechables con 2FA y los borra al
 * final; deja la configuración del asistente como estaba. La parte con base se salta si no hay service_role.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { usd } from "@/lib/asistente/dinero";
import { decidirModelo, modeloPermitido, modelosPermitidos, sumarUso, usoVacio, type ConfigModelo } from "@/lib/asistente/modelo";
import { responder } from "@/lib/asistente/responder";
import type { Contexto, Fuente } from "@/lib/asistente/tipos";
import type { VersionVigente } from "@/lib/semantic/contracts";
import { codigoTotp } from "./totp";

vi.mock("server-only", () => ({}));
const { columnasUso, gastoMes, guardarTope, leerConfig } = await import("@/lib/asistente/config-servidor");
const {
  agregarAlInforme, editarItemInforme, leerInforme, ordenarInforme, quitarDelInforme, valorarTurno,
} = await import("@/lib/asistente/conversaciones");

// --- Contexto de prueba (cubo simulado) --------------------------------------------------------------------------
const meta: VersionVigente["metadatos"] = {
  periodos: [
    { anio: 2026, mes: 8, dias: 26, ultimo_dia: "2026-08-31", cerrado: true },
    { anio: 2026, mes: 9, dias: 26, ultimo_dia: "2026-09-30", cerrado: true },
  ],
  canal: ["Detalle", "Mayoreo"], ruta: ["127 - EL PARAÍSO"], marca: ["ORO"], producto: [{ codigo: "1001", descripcion: "CAFE ORO 400G" }], rutas_total: 1,
};
const version: VersionVigente = { version: 1, fecha_corte: "2026-09-30", conciliada_bi: false, publicado_en: "2026-10-01T00:00:00Z", archivo: "Data.xlsx", metadatos: meta };
const fuente: Fuente = {
  kpiPeriodo: async () => ({ venta_neta: 90, kg: 9, precio_kg: 10, clientes_con_compra: 50, venta_neta_cmp: 100, kg_cmp: 10, precio_kg_cmp: 10, clientes_con_compra_cmp: 48, rutas_con_venta: 1, rutas_total: 1 }),
  variacionPorDimension: async () => [{ valor: "Mayoreo", actual: 60, anterior: 68, variacion: -8 }, { valor: "Detalle", actual: 30, anterior: 32, variacion: -2 }],
  topContribuyentes: async () => [{ ruta: "127 - EL PARAÍSO", canal: "Mayoreo", actual: 30, anterior: 37, variacion: -7 }],
  serieMensual: async ({ anio }) => [{ anio, mes: 9, venta_neta: 90, kg: 9 }],
  descomposicion: async () => ({
    actual: { venta_neta: 90, kg: 9, lineas: 10, clientes: 50, facturas: 100, facturas_por_cliente: 2, ticket_factura: 0.9, venta_por_cliente: 1.8 },
    anterior: { venta_neta: 100, kg: 10, lineas: 10, clientes: 48, facturas: 101, facturas_por_cliente: 2.1, ticket_factura: 0.99, venta_por_cliente: 2.08 },
  }),
};
const ctx: Contexto = { fuente, version, estado: { periodo: { anio: 2026, mes: 9 }, comparar: "anterior", filtros: {} } };

/** OpenRouter simulado: devuelve las respuestas en orden y guarda los cuerpos enviados. */
function openRouterFalso(respuestas: (object | Response)[]) {
  const cuerpos: Record<string, unknown>[] = [];
  let i = 0;
  const fetchFalso = (async (_url: unknown, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)));
    const r = respuestas[i++];
    return r instanceof Response ? r : new Response(JSON.stringify(r));
  }) as typeof fetch;
  return { fetch: fetchFalso, cuerpos };
}
const llamadaKpi = {
  choices: [{ message: { content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "kpi_periodo", arguments: JSON.stringify({ periodo: "2026-09", comparado: "2026-08" }) } }] } }],
};
const final = (texto: string) => ({ choices: [{ message: { content: JSON.stringify({ texto, hipotesis: [], visuales: ["c1"] }) } }] });

// --- Costo por pregunta --------------------------------------------------------------------------------------------
describe("uso y costo de OpenRouter", () => {
  it("suma tokens y costo de todas las rondas y pide usage en cada llamada", async () => {
    const or = openRouterFalso([
      { ...llamadaKpi, usage: { prompt_tokens: 1200, completion_tokens: 40, cost: 0.0012 } },
      { ...final("La venta bajó contra el mes anterior."), usage: { prompt_tokens: 1500, completion_tokens: 90, cost: 0.0021, is_byok: false } },
    ]);
    const uso = usoVacio();
    const cfg: ConfigModelo = { apiKey: "llave-falsa", modelo: "acme/modelo", fetch: or.fetch };
    const r = await responder("¿Cómo va la venta?", [], ctx, cfg, { uso });
    expect(r.modo).toBe("modelo");
    expect(uso).toMatchObject({ llamadas: 2, tokensEntrada: 2700, tokensSalida: 130, sinUso: 0, sinCosto: { entrada: 0, salida: 0 } });
    expect(uso.costoUsd).toBeCloseTo(0.0033, 10);
    expect(or.cuerpos).toHaveLength(2);
    for (const c of or.cuerpos) expect(c.usage).toEqual({ include: true });
  });

  it("si el modelo falla a media pregunta, conserva lo gastado y responde en automático", async () => {
    const or = openRouterFalso([
      { ...llamadaKpi, usage: { prompt_tokens: 1000, completion_tokens: 30, cost: 0.001 } },
      new Response("caído", { status: 502 }),
    ]);
    const uso = usoVacio();
    const r = await responder("¿Cómo va la venta?", [], ctx, { apiKey: "x", modelo: "acme/modelo", fetch: or.fetch }, { uso });
    expect(r.modo).toBe("determinista");
    expect(uso.llamadas).toBe(1);
    expect(uso.costoUsd).toBeCloseTo(0.001, 10);
  });

  it("tolera usage ausente o sin costo: cuenta las rondas y deja los tokens para estimar", () => {
    const uso = usoVacio();
    sumarUso(uso, undefined);
    sumarUso(uso, { prompt_tokens: 100, completion_tokens: 10 });
    sumarUso(uso, { prompt_tokens: "mucho", cost: -1 });
    sumarUso(uso, { prompt_tokens: 50, completion_tokens: 5, cost: 0.0001 });
    expect(uso).toMatchObject({ llamadas: 4, sinUso: 2, tokensEntrada: 150, tokensSalida: 15, sinCosto: { entrada: 100, salida: 10 } });
    expect(uso.costoUsd).toBeCloseTo(0.0001, 10);
  });

  it("columnasUso: sin llamadas todo nulo; sin costo informado lo estima con los precios del catálogo", async () => {
    expect(await columnasUso(usoVacio(), "acme/modelo")).toEqual({ tokens_entrada: null, tokens_salida: null, costo_usd: null, costo_estimado: false });
    const soloSinDatos = usoVacio();
    sumarUso(soloSinDatos, null);
    expect(await columnasUso(soloSinDatos, "acme/modelo")).toMatchObject({ costo_usd: null, tokens_entrada: null });

    const fetchReal = globalThis.fetch;
    const f = vi.spyOn(globalThis, "fetch").mockImplementation((entrada, init) =>
      String(entrada instanceof Request ? entrada.url : entrada).startsWith("https://openrouter.ai/api/v1/models")
        ? Promise.resolve(new Response(JSON.stringify({ data: [{ id: "acme/modelo", name: "Acme", pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["tools"] }] })))
        : fetchReal(entrada, init));
    const uso = usoVacio();
    sumarUso(uso, { prompt_tokens: 1000, completion_tokens: 500, cost: 0.01 });
    sumarUso(uso, { prompt_tokens: 2000, completion_tokens: 1000 }); // sin costo: 2000 × $1/M + 1000 × $2/M = $0.004
    const c = await columnasUso(uso, "acme/modelo");
    f.mockRestore();
    expect(c).toMatchObject({ tokens_entrada: 3000, tokens_salida: 1500, costo_estimado: true });
    expect(c.costo_usd).toBeCloseTo(0.014, 8);
  });

  it("usd: centavos y fracciones de centavo", () => {
    expect(usd(1234.5)).toBe("US$ 1,234.50");
    expect(usd(0.0033)).toBe("US$ 0.0033");
    expect(usd(0)).toBe("US$ 0.00");
  });
});

// --- Tope y modelos permitidos -------------------------------------------------------------------------------------
describe("tope de gasto y modelos permitidos", () => {
  const cfg: ConfigModelo = { apiKey: "x", modelo: "anthropic/claude-sonnet-5.5" };

  it("bajo el tope responde el modelo; al llegar al tope pasa a automático con aviso", () => {
    expect(decidirModelo(cfg, { topeUsd: 10, gastoUsd: 9.99 })).toEqual({ modelo: cfg, motivo: null, aviso: null });
    expect(decidirModelo(cfg, { topeUsd: null, gastoUsd: 500 }).modelo).toBe(cfg);
    expect(decidirModelo(cfg, { topeUsd: 10, gastoUsd: null }).modelo).toBe(cfg); // gasto ilegible: no frena
    const d = decidirModelo(cfg, { topeUsd: 10, gastoUsd: 10 });
    expect(d.modelo).toBeNull();
    expect(d.motivo).toBe("tope_gasto");
    expect(d.aviso).toMatch(/tope de gasto de IA del mes \(US\$ 10\.00\)/);
    expect(decidirModelo(null, { topeUsd: 1, gastoUsd: 5 })).toEqual({ modelo: null, motivo: null, aviso: null });
  });

  it("con el tope alcanzado la respuesta es determinista y trae el aviso primero", async () => {
    const d = decidirModelo({ ...cfg, fetch: (() => { throw new Error("no debe llamar a OpenRouter"); }) as typeof fetch }, { topeUsd: 5, gastoUsd: 7 });
    const r = await responder("¿Dónde se concentra la variación por canal?", [], ctx, d.modelo, { aviso: d.aviso });
    expect(r.modo).toBe("determinista");
    expect(r.estado).toBe("ok");
    expect(r.evidencia.advertencias[0]).toBe(d.aviso);
  });

  it("un modelo fuera de la lista de permitidos también pasa a automático", () => {
    const d = decidirModelo(cfg, { permitidos: ["deepseek/*"], topeUsd: null, gastoUsd: null });
    expect(d).toMatchObject({ modelo: null, motivo: "modelo_no_permitido" });
    expect(d.aviso).toContain("anthropic/claude-sonnet-5.5");
  });

  it("lista de permitidos: ids exactos, comodín por proveedor, sin distinguir mayúsculas", () => {
    expect(modelosPermitidos(undefined)).toBeNull();
    expect(modelosPermitidos(" , ")).toBeNull();
    const lista = modelosPermitidos(" anthropic/* , DeepSeek/deepseek-v4.1-flash ,");
    expect(lista).toEqual(["anthropic/*", "deepseek/deepseek-v4.1-flash"]);
    expect(modeloPermitido("anthropic/claude-sonnet-5.5", lista)).toBe(true);
    expect(modeloPermitido("anthropic/claude-haiku-5:free", lista)).toBe(true);
    expect(modeloPermitido("deepseek/deepseek-v4.1-flash", lista)).toBe(true);
    expect(modeloPermitido("deepseek/deepseek-v4.1-flash:free", lista)).toBe(false);
    expect(modeloPermitido("deepseek/otro", lista)).toBe(false);
    expect(modeloPermitido("anthropicx/claude", lista)).toBe(false);
    expect(modeloPermitido("anthropic/", lista)).toBe(false);
    expect(modeloPermitido("openai/gpt-6", null)).toBe(true);
  });
});

// --- Base: valoraciones, informe, gasto y tope -----------------------------------------------------------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!url || !anon || !service)("valoraciones e informe: solo del dueño del turno", () => {
  let svc: SupabaseClient;
  const creados: string[] = [];
  let a: { sb: SupabaseClient; id: string }, b: { sb: SupabaseClient; id: string };
  let t1 = 0, t2 = 0, tError = 0;
  let topeOriginal: number | null = null;
  const desde = new Date().toISOString();
  const ventas = (sb: SupabaseClient) => sb.schema("ventas");

  async function usuario(nombre: string) {
    const email = `prueba-uso-${nombre}-${Date.now()}@bia.test`, password = randomBytes(12).toString("hex") + "a1";
    const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    creados.push(data.user.id);
    const p = await svc.from("perfil").insert({ user_id: data.user.id, nombre, nivel: "estandar" });
    if (p.error) throw p.error;
    const sb = createClient(url!, anon!, opciones);
    const login = await sb.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    const alta = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "prueba" });
    if (alta.error) throw alta.error;
    const v = await sb.auth.mfa.challengeAndVerify({ factorId: alta.data.id, code: codigoTotp(alta.data.totp.secret) });
    if (v.error) throw v.error;
    return { sb, id: data.user.id };
  }

  beforeAll(async () => {
    svc = createClient(url!, service!, opciones);
    topeOriginal = (await leerConfig()).topeUsd;
    [a, b] = await Promise.all([usuario("a"), usuario("b")]);
    const conv = await ventas(svc).from("conversacion").insert({ usuario_id: a.id, titulo: "Uso", contexto: "periodo=2026-09" }).select("id").single();
    if (conv.error) throw conv.error;
    const turno = (pregunta: string, estado = "ok") => ({
      usuario_id: a.id, conversacion_id: conv.data.id, version: null, contexto: "periodo=2026-09", pregunta, estado,
      modo: estado === "error" ? null : "determinista", texto: estado === "error" ? null : "respuesta de prueba",
      respuesta: estado === "error" ? null : { estado: "ok", texto: "respuesta de prueba", consultas: [] }, error: estado === "error" ? "falló" : null, duracion_ms: 1,
    });
    const t = await ventas(svc).from("consulta_asistente")
      .insert([turno("¿Primera?"), turno("¿Segunda?"), turno("¿Con error?", "error")]).select("id, pregunta");
    if (t.error) throw t.error;
    const id = (p: string) => t.data.find((x) => x.pregunta === p)!.id as number;
    [t1, t2, tError] = [id("¿Primera?"), id("¿Segunda?"), id("¿Con error?")];
  });

  afterAll(async () => {
    if (!svc) return;
    if (creados.length) {
      await ventas(svc).from("consulta_asistente").delete().in("usuario_id", creados);
      await ventas(svc).from("prueba_modelo").delete().in("usuario_id", creados);
      await ventas(svc).from("conversacion").delete().in("usuario_id", creados);
    }
    for (const id of creados) await svc.auth.admin.deleteUser(id);
    await ventas(svc).from("config_asistente").update({ tope_mensual_usd: topeOriginal }).eq("id", true);
    await ventas(svc).from("config_asistente_cambio").delete().gte("creado_en", desde);
  });

  it("el dueño valora (👎 con comentario), cambia y quita; lo lee solo él", async () => {
    expect(await valorarTurno(a.id, t1, false, "  Faltó abrir por ruta.  ")).toEqual({ valoracion: { util: false, comentario: "Faltó abrir por ruta." } });
    const propia = await ventas(a.sb).from("valoracion_respuesta").select("consulta_id, util, comentario");
    expect(propia.data).toEqual([{ consulta_id: t1, util: false, comentario: "Faltó abrir por ruta." }]);
    expect((await ventas(b.sb).from("valoracion_respuesta").select("consulta_id")).data).toEqual([]);
    // Embebida en la bitácora, como la carga el chat (sesión del usuario).
    const embebida = await ventas(a.sb).from("consulta_asistente").select("id, valoracion_respuesta(util)").eq("id", t1).single();
    expect(JSON.stringify(embebida.data)).toContain('"util":false');

    expect(await valorarTurno(a.id, t1, true)).toEqual({ valoracion: { util: true, comentario: null } });
    expect(await valorarTurno(a.id, t1, null)).toEqual({ valoracion: null });
    expect((await ventas(svc).from("valoracion_respuesta").select("consulta_id").eq("consulta_id", t1)).data).toEqual([]);
  });

  it("nadie valora un turno ajeno, uno con error ni escribe directo en la tabla", async () => {
    await valorarTurno(a.id, t2, true);
    expect(await valorarTurno(b.id, t2, false, "intruso")).toBeNull();
    expect(await valorarTurno(b.id, t2, null)).toBeNull();
    expect(await valorarTurno(a.id, tError, true)).toBeNull();
    expect(await valorarTurno(a.id, 9_007_199_254_740, true)).toBeNull();
    const sigue = await ventas(svc).from("valoracion_respuesta").select("usuario_id, util").eq("consulta_id", t2).single();
    expect(sigue.data).toEqual({ usuario_id: a.id, util: true });

    expect((await ventas(a.sb).from("valoracion_respuesta").insert({ consulta_id: t1, usuario_id: a.id, util: true })).error).not.toBeNull();
    expect((await ventas(b.sb).from("valoracion_respuesta").update({ util: false }).eq("consulta_id", t2).select("consulta_id")).data ?? []).toEqual([]);
    expect((await ventas(a.sb).rpc("valorar_respuesta", { p_usuario: a.id, p_consulta: t1, p_util: true })).error).not.toBeNull();
  });

  it("informe: el dueño agrega (sin repetir), ordena, titula y quita; otro usuario no ve ni toca nada", async () => {
    expect(await agregarAlInforme(b.id, t1)).toBeNull(); // turno ajeno
    expect(await agregarAlInforme(a.id, tError)).toBeNull(); // sin respuesta
    expect(await agregarAlInforme(a.id, t1)).toEqual({});
    expect(await agregarAlInforme(a.id, t2)).toEqual({});
    expect(await agregarAlInforme(a.id, t1)).toEqual({}); // idempotente
    expect((await leerInforme(a.id)).map((i) => i.turnoId)).toEqual([t1, t2]);
    expect(await leerInforme(b.id)).toEqual([]);

    expect(await ordenarInforme(a.id, [t2, t1])).toBe(true);
    expect(await ordenarInforme(a.id, [t2])).toBe(false); // falta uno
    expect(await ordenarInforme(a.id, [t2, t2])).toBe(false); // repetido
    expect(await ordenarInforme(b.id, [t1, t2])).toBe(false);
    expect((await leerInforme(a.id)).map((i) => i.turnoId)).toEqual([t2, t1]);

    expect(await editarItemInforme(a.id, t1, "  Caída de septiembre ", "Para la reunión del lunes.")).toBe(true);
    expect(await editarItemInforme(b.id, t1, "secuestrado", "")).toBe(false);
    const item = (await leerInforme(a.id)).find((i) => i.turnoId === t1)!;
    expect(item).toMatchObject({ titulo: "Caída de septiembre", nota: "Para la reunión del lunes.", pregunta: "¿Primera?" });
    expect(item.respuesta).toMatchObject({ texto: "respuesta de prueba" });
    expect(await editarItemInforme(a.id, t1, "", "")).toBe(true);
    expect((await leerInforme(a.id)).find((i) => i.turnoId === t1)).toMatchObject({ titulo: null, nota: null });

    // Lectura directa por la API: cada quien solo lo suyo; nadie escribe directo.
    expect((await ventas(a.sb).from("informe_item").select("consulta_id")).data).toHaveLength(2);
    expect((await ventas(b.sb).from("informe_item").select("consulta_id")).data).toEqual([]);
    expect((await ventas(b.sb).from("informe_item").insert({ usuario_id: b.id, consulta_id: t1, orden: 0 })).error).not.toBeNull();
    expect((await ventas(a.sb).rpc("informe_agregar", { p_usuario: a.id, p_consulta: t1 })).error).not.toBeNull();

    expect(await quitarDelInforme(b.id, t1)).toBe(false);
    expect(await quitarDelInforme(a.id, t1)).toBe(true);
    expect((await leerInforme(a.id)).map((i) => i.turnoId)).toEqual([t2]);
  });

  it("gasto del mes: suma el costo de preguntas y pruebas", async () => {
    const antes = await gastoMes();
    const conv = await ventas(svc).from("consulta_asistente").select("conversacion_id").eq("id", t1).single();
    const ins = await ventas(svc).from("consulta_asistente").insert({
      usuario_id: a.id, conversacion_id: conv.data!.conversacion_id, contexto: "", pregunta: "¿Con costo?", estado: "ok", modo: "modelo",
      modelo: "acme/modelo", texto: "x", respuesta: { estado: "ok" }, duracion_ms: 1, tokens_entrada: 1000, tokens_salida: 100, costo_usd: 0.25,
    });
    expect(ins.error).toBeNull();
    expect((await ventas(svc).from("prueba_modelo").insert({ usuario_id: a.id, modelo: "acme/modelo", costo_usd: 0.125 })).error).toBeNull();
    const despues = await gastoMes();
    // Otras preguntas reales pueden sumar al mismo tiempo: al menos lo agregado aquí.
    expect(despues.totalUsd - antes.totalUsd).toBeGreaterThanOrEqual(0.375 - 1e-9);
    expect(despues.pruebasUsd - antes.pruebasUsd).toBeGreaterThanOrEqual(0.125 - 1e-9);
    expect(new Date(despues.desde).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("tope: se guarda con su cambio en el historial y vacío lo quita", async () => {
    const original = topeOriginal;
    const nuevo = original === 12.34 ? 56.78 : 12.34;
    expect(await guardarTope(nuevo, a.id)).toEqual({});
    expect(await guardarTope(nuevo, a.id)).toEqual({}); // sin cambio: no escribe
    expect(await guardarTope(-1, a.id)).toMatchObject({ error: expect.any(String) });
    const fila = await ventas(svc).from("config_asistente").select("tope_mensual_usd").single();
    expect(Number(fila.data!.tope_mensual_usd)).toBe(nuevo);
    const cambios = await ventas(svc).from("config_asistente_cambio").select("antes, despues").gte("creado_en", desde).eq("usuario_id", a.id);
    expect(cambios.data).toHaveLength(1);
    expect(Number(cambios.data![0].despues.tope_mensual_usd)).toBe(nuevo);
    expect(cambios.data![0].despues).toHaveProperty("usar_ia");
    expect(await guardarTope(original, a.id)).toEqual({});
  });
});
