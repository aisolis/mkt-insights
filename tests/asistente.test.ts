import { describe, expect, it, vi } from "vitest";
import { fueraDeAlcance } from "@/lib/asistente/alcance";
import { interpretar, llamadas } from "@/lib/asistente/determinista";
import { ejecutar, ErrorHerramienta, herramientasModelo } from "@/lib/asistente/herramientas";
import { responder } from "@/lib/asistente/responder";
import type { Contexto, Fuente } from "@/lib/asistente/tipos";
import { cifrasNoVerificadas, cifrasPermitidas } from "@/lib/asistente/verificar";
import type { VersionVigente } from "@/lib/semantic/contracts";

const meta: VersionVigente["metadatos"] = {
  periodos: [
    { anio: 2025, mes: 9, dias: 26, ultimo_dia: "2025-09-30", cerrado: true },
    { anio: 2026, mes: 8, dias: 26, ultimo_dia: "2026-08-31", cerrado: true },
    { anio: 2026, mes: 9, dias: 26, ultimo_dia: "2026-09-30", cerrado: true },
    { anio: 2026, mes: 10, dias: 12, ultimo_dia: "2026-10-15", cerrado: false },
  ],
  canal: ["Detalle", "Mayoreo", "Moderno"],
  ruta: ["127 - EL PARAÍSO", "103 - WALMART ZC"],
  marca: ["ORO", "Cafe Oro", "MAYA", "CREMA MAYA"],
  producto: [{ codigo: "1001", descripcion: "CAFE ORO 400G" }],
  rutas_total: 2,
};
const version: VersionVigente = { version: 1, fecha_corte: "2026-10-15", conciliada_bi: false, publicado_en: "2026-10-28T00:00:00Z", archivo: "Data Historica.xlsx", metadatos: meta };

const fuente: Fuente = {
  kpiPeriodo: async () => ({ venta_neta: 90, kg: 9, precio_kg: 10, clientes_con_compra: 50, venta_neta_cmp: 100, kg_cmp: 10, precio_kg_cmp: 10, clientes_con_compra_cmp: 48, rutas_con_venta: 2, rutas_total: 2 }),
  variacionPorDimension: async () => [
    { valor: "Mayoreo", actual: 60, anterior: 68, variacion: -8 },
    { valor: "Detalle", actual: 20, anterior: 23, variacion: -3 },
    { valor: "Moderno", actual: 10, anterior: 9, variacion: 1 },
  ],
  topContribuyentes: async () => [{ ruta: "127 - EL PARAÍSO", canal: "Mayoreo", actual: 30, anterior: 37, variacion: -7 }],
  serieMensual: async ({ anio }) => [{ anio, mes: 9, venta_neta: 90, kg: 9 }],
  descomposicion: async () => ({
    actual: { venta_neta: 90, kg: 9, lineas: 10, clientes: 50, facturas: 100, facturas_por_cliente: 2, ticket_factura: 0.9, venta_por_cliente: 1.8 },
    anterior: { venta_neta: 100, kg: 10, lineas: 10, clientes: 48, facturas: 101, facturas_por_cliente: 2.1, ticket_factura: 0.99, venta_por_cliente: 2.08 },
  }),
};
const ctx = (over: Partial<Contexto["estado"]> = {}): Contexto => ({
  fuente, version, estado: { periodo: { anio: 2026, mes: 9 }, comparar: "anterior", filtros: {}, ...over },
});

describe("alcance", () => {
  it.each([
    "¿Cuál es nuestro market share en café?",
    "¿Cuánto vamos a vender en noviembre?",
    "¿Cuántas visitas hicimos en la ruta 127?",
    "¿Cuántos pedidos hubo en septiembre?",
    "¿Qué clientes dejaron de comprar?",
    "Dame los principales clientes de Mayoreo",
    "¿Cómo estamos contra la competencia?",
  ])("bloquea: %s", (p) => expect(fueraDeAlcance(p)).not.toBeNull());

  it.each([
    "¿Dónde se concentra la caída de septiembre?",
    "¿Cuántos clientes compraron en septiembre?",
    "¿Bajó el número de facturas o el ticket?",
    "Evolución mensual de 2025",
  ])("permite: %s", (p) => expect(fueraDeAlcance(p)).toBeNull());
});

describe("intérprete", () => {
  it("hereda periodo y filtros del dashboard y arma el diagnóstico", () => {
    const plan = interpretar("¿Dónde se concentra la caída?", ctx({ filtros: { canal: "Mayoreo" } }));
    expect(plan).toMatchObject({ tipo: "diagnostico", periodo: { anio: 2026, mes: 9 }, comparado: { anio: 2026, mes: 8 }, filtros: { canal: "Mayoreo" } });
    // Con canal filtrado no abre por canal.
    expect(llamadas(plan).map((l) => l.herramienta)).toEqual(["kpi_periodo", "descomposicion", "top_rutas", "variacion_por_dimension"]);
  });

  it("lee marca, canal, mes y comparación interanual de la pregunta", () => {
    const plan = interpretar("¿Cómo le fue a la marca ORO en Mayoreo en septiembre vs. el año anterior?", ctx());
    expect(plan.filtros).toEqual({ marca: "ORO", canal: "Mayoreo" });
    expect(plan.comparado).toEqual({ anio: 2025, mes: 9 });
  });

  it("un mes después de 'vs.' es el comparado", () => {
    expect(interpretar("¿Por qué cayó vs. agosto?", ctx())).toMatchObject({ periodo: { anio: 2026, mes: 9 }, comparado: { anio: 2026, mes: 8 } });
    expect(interpretar("octubre contra septiembre", ctx())).toMatchObject({ periodo: { anio: 2026, mes: 10 }, comparado: { anio: 2026, mes: 9 } });
  });

  it("prefiere la marca más larga y no confunde 'detalle' con el canal", () => {
    expect(interpretar("variación de CREMA MAYA", ctx()).filtros).toEqual({ marca: "CREMA MAYA" });
    expect(interpretar("dame el detalle por ruta", ctx()).filtros).toEqual({});
    expect(interpretar("¿qué pasó en Detalle?", ctx()).filtros).toEqual({ canal: "Detalle" });
  });

  it("serie, kpi y dimensión", () => {
    expect(interpretar("Evolución mensual de 2025", ctx()).tipo).toBe("serie");
    expect(interpretar("Evolución mensual de 2025", ctx()).periodo.anio).toBe(2025);
    expect(interpretar("¿Cuánto vendimos en agosto 2026?", ctx())).toMatchObject({ tipo: "kpi", periodo: { anio: 2026, mes: 8 } });
    expect(interpretar("variación por zona", ctx())).toMatchObject({ tipo: "dimension", dimensiones: ["zona"] });
  });
});

describe("herramientas", () => {
  it("normalizan filtros contra el catálogo y rechazan valores inexistentes", async () => {
    const r = await ejecutar("kpi_periodo", { periodo: "2026-09", comparado: "2026-08", filtros: { ruta: "el paraiso", marca: "oro" } }, ctx(), "c1");
    expect(r.filtros).toEqual({ ruta: "127 - EL PARAÍSO", marca: "ORO" });
    await expect(ejecutar("kpi_periodo", { periodo: "2026-09", comparado: "2026-08", filtros: { canal: "Mayorista" } }, ctx(), "c1")).rejects.toThrow(ErrorHerramienta);
    await expect(ejecutar("kpi_periodo", { periodo: "2024-01", comparado: "2026-08" }, ctx(), "c1")).rejects.toThrow(/no tiene datos/);
    await expect(ejecutar("borrar_todo", {}, ctx(), "c1")).rejects.toThrow(/desconocida/);
  });

  it("calculan la participación en la variación sin que la calcule el modelo", async () => {
    const r = await ejecutar("variacion_por_dimension", { dimension: "canal", periodo: "2026-09", comparado: "2026-08" }, ctx(), "c1");
    expect(r.hechos[0]).toContain("Mayoreo (−L 8, 80.0% de la variación)");
    expect(JSON.stringify(r.resumen)).not.toMatch(/cliente_(codigo|nombre)|subgrupo/);
  });

  it("se publican al modelo como funciones con JSON Schema", () => {
    const defs = herramientasModelo();
    expect(defs.map((d) => d.function.name)).toEqual(["kpi_periodo", "variacion_por_dimension", "top_rutas", "serie_mensual", "descomposicion"]);
    expect(defs[1].function.parameters).toMatchObject({ type: "object", required: ["dimension", "periodo", "comparado"] });
  });
});

describe("verificador de cifras", () => {
  it("acepta solo cifras presentes en las consultas", () => {
    const ok = cifrasPermitidas([{ variacion: "−L 8.4 M", pct: "−6.9%" }, ["Venta neta L 140.2 M"]]);
    expect(cifrasNoVerificadas("Cayó 6.9% (−L 8.4 M) en septiembre 2026, a L 140.2 M.", ok)).toEqual([]);
    expect(cifrasNoVerificadas("Cayó 7.2%, unos L 8.35 M.", ok)).toEqual(["7.2", "8.35"]);
  });
});

describe("responder", () => {
  it("fuera de alcance: no consulta ni muestra cifras", async () => {
    const spy = vi.spyOn(fuente, "kpiPeriodo");
    const r = await responder("¿Cuál es el market share de ORO?", [], ctx(), null);
    expect(r).toMatchObject({ estado: "fuera_de_alcance", hechos: [], visuales: [], consultas: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("determinista: texto, hechos, hipótesis y evidencia completa", async () => {
    const r = await responder("¿Dónde se concentra la caída?", [], ctx(), null);
    expect(r.modo).toBe("determinista");
    expect(r.texto).toMatch(/cayó 10.0% vs. agosto 2026/);
    expect(r.texto).toContain("canal en Mayoreo");
    expect(r.hipotesis.length).toBeGreaterThan(0);
    expect(r.hipotesis.join(" ")).not.toMatch(/\d/);
    expect(r.evidencia).toMatchObject({ version: 1, cobertura: "2/2 rutas con venta en el periodo", periodo: "septiembre 2026 vs. agosto 2026", filtros: "sin filtros (Honduras, todos los canales)" });
    expect(r.evidencia.advertencias.join(" ")).toMatch(/no conciliadas/);
    expect(r.consultas.map((c) => c.calculo)).toContain("ventas.descomposicion");
  });

  it("modelo: ejecuta las herramientas que pide y usa su texto si las cifras cuadran", async () => {
    const fetch = respuestasModelo([
      { tool_calls: [{ id: "t1", type: "function", function: { name: "variacion_por_dimension", arguments: JSON.stringify({ dimension: "canal", periodo: "2026-09", comparado: "2026-08" }) } }] },
      { content: JSON.stringify({ texto: "La caída se concentra en Mayoreo (−L 8, 80.0% de la variación).", hipotesis: ["Menos rotación en mayoristas."], visuales: ["c1"] }) },
    ]);
    const r = await responder("¿Dónde cae?", [], ctx(), { apiKey: "test", modelo: "m", fetch });
    expect(r.modo).toBe("modelo");
    expect(r.texto).toBe("La caída se concentra en Mayoreo (−L 8, 80.0% de la variación).");
    expect(r.visuales[0]).toMatchObject({ tipo: "variacion" });
    // Agrega kpi_periodo para la cobertura de la evidencia.
    expect(r.consultas.map((c) => c.herramienta)).toEqual(["variacion_por_dimension", "kpi_periodo"]);
    expect(r.evidencia.cobertura).not.toBeNull();
    const cuerpo = JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string);
    expect(cuerpo.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "t1" });
  });

  it("modelo: si inventa una cifra se descarta su texto", async () => {
    const fetch = respuestasModelo([
      { tool_calls: [{ id: "t1", type: "function", function: { name: "kpi_periodo", arguments: JSON.stringify({ periodo: "2026-09", comparado: "2026-08" }) } }] },
      { content: JSON.stringify({ texto: "Cayó 12.3% por la competencia.", hipotesis: [], visuales: [] }) },
    ]);
    const r = await responder("¿Cuánto cayó?", [], ctx(), { apiKey: "test", modelo: "m", fetch });
    expect(r.texto).not.toContain("12.3");
    expect(r.evidencia.advertencias[0]).toMatch(/cifras que no salen de las consultas \(12.3\)/);
  });

  it("modelo: si falla la llamada responde en modo determinista", async () => {
    const fetch = vi.fn(async () => new Response("caído", { status: 503 }));
    const r = await responder("¿Dónde se concentra la caída?", [], ctx(), { apiKey: "test", modelo: "m", fetch });
    expect(r.modo).toBe("determinista");
    expect(r.evidencia.advertencias[0]).toMatch(/El modelo no respondió/);
    vi.restoreAllMocks();
  });
});

function respuestasModelo(mensajes: { content?: string; tool_calls?: unknown[] }[]) {
  let i = 0;
  return vi.fn<typeof fetch>(async () =>
    Response.json({ choices: [{ message: { content: mensajes[i]?.content ?? null, tool_calls: mensajes[i++]?.tool_calls } }] }));
}
