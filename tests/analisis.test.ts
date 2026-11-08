/**
 * G9 — análisis comercial: puente precio–volumen–mezcla (S23), acumulado del año (S24) y rutas fuera de lo normal
 * (S25). Primero la lógica pura (textos, advertencias, herramientas e intérprete con un doble); después, contra la
 * versión publicada del Supabase local, que el puente cuadre al centavo y que el acumulado sume lo mismo que los
 * meses. La parte con base se salta si no hay service_role (CI sin base). Solo lee: no publica ni retira versiones.
 */
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { interpretar, llamadas } from "@/lib/asistente/determinista";
import { ejecutar, ErrorHerramienta, herramientasModelo } from "@/lib/asistente/herramientas";
import { responder } from "@/lib/asistente/responder";
import type { Contexto, Fuente } from "@/lib/asistente/tipos";
import { cifrasNoVerificadas, cifrasPermitidas } from "@/lib/asistente/verificar";
import { advertenciasAcumulado, motivoAtipica, pasosPuente, rangoAcumulado } from "@/lib/dashboard/analisis";
import { crearConsultas, type Rpc } from "@/lib/semantic/consultas";
import type { Acumulado, Puente, RutaAtipica, RutasAtipicas, VersionVigente } from "@/lib/semantic/contracts";

const meta: VersionVigente["metadatos"] = {
  periodos: [
    ...Array.from({ length: 12 }, (_, i) => ({ anio: 2025, mes: i + 1, dias: 26, ultimo_dia: `2025-${String(i + 1).padStart(2, "0")}-28`, cerrado: true })),
    ...Array.from({ length: 9 }, (_, i) => ({ anio: 2026, mes: i + 1, dias: 26, ultimo_dia: `2026-${String(i + 1).padStart(2, "0")}-28`, cerrado: true })),
    { anio: 2026, mes: 10, dias: 12, ultimo_dia: "2026-10-15", cerrado: false },
  ],
  canal: ["Detalle", "Mayoreo", "Moderno"],
  ruta: ["127 - EL PARAÍSO", "103 - WALMART ZC"],
  marca: ["ORO", "MAYA"],
  producto: [{ codigo: "1001", descripcion: "CAFE ORO 400G" }, { codigo: "1002", descripcion: "CAFE MAYA 200G" }],
  rutas_total: 2,
};
const version: VersionVigente = { version: 1, fecha_corte: "2026-10-15", conciliada_bi: false, publicado_en: "2026-10-28T00:00:00Z", archivo: "Data Historica.xlsx", metadatos: meta };

const producto = (codigo: string, descripcion: string, over: Partial<Puente["detalle_precio"][number]> = {}) => ({
  art_codigo: codigo, descripcion, kg: 1000, kg_cmp: 1200, venta_neta: 210000, venta_neta_cmp: 240000, precio_kg: 210, precio_kg_cmp: 200,
  efecto_volumen: -40000, efecto_precio: 10000, efecto_mezcla: 0, ...over,
});
// Cuadra: −13,002,028.62 − 1,550,853.82 + 3,657,294.57 + 1,342,455.47 − 825,946.00 − 27.24 + 214.50 = −10,378,891.14
const PUENTE: Puente = {
  venta_neta: 140170115, venta_neta_cmp: 150549006.14, variacion: -10378891.14,
  volumen: -13002028.62, precio: -1550853.82, mezcla: 3657294.57, nuevos: 1342455.47, descontinuados: -825946, sin_volumen: 187.26,
  kg_comparables: 636170.5355, kg_comparables_cmp: 696669.6002, precio_kg_comparables: 218.22, precio_kg_comparables_cmp: 214.91,
  productos_comparables: 122, productos_nuevos: 3, productos_descontinuados: 17, productos_sin_volumen: 2,
  detalle_precio: [producto("1001", "CAFE ORO 400G", { efecto_precio: -567444.33, precio_kg: 255.92, precio_kg_cmp: 264.22 })],
  detalle_mezcla: [producto("1002", "CAFE MAYA 200G", { efecto_mezcla: 291373.84, kg: 68407, kg_cmp: 60000 })],
  principales_nuevos: [{ art_codigo: "170028", descripcion: "Oro 405 gr", variacion: 1096490 }],
  principales_descontinuados: [],
};
const ACUMULADO: Acumulado = {
  anio: 2026, mes: 9, venta_neta: 1344140077.13, kg: 6336618.6159, precio_kg: 212.12, clientes_con_compra: 22295,
  venta_neta_cmp: 1416272828.88, kg_cmp: 8492075.6801, precio_kg_cmp: 166.78, clientes_con_compra_cmp: 26620,
  meses: [1, 2, 3, 4, 5, 6, 7, 8, 9], meses_cmp: [1, 2, 3, 4, 5, 6, 7, 8, 9],
};
const RUTA: RutaAtipica = {
  ruta: "127 - EL PARAÍSO", canal: "Mayoreo", actual: 2550329.72, anterior: 550566.47, variacion: 1999763.25,
  cambio: 3.6322, mediana: 0.0447, escala: 0.53, minimo: -0.7013, maximo: 0.834, puntaje: 6.8, meses_historia: 12, promedio_mensual: 1309229.32,
};
const ATIPICAS: RutasAtipicas = {
  hay_periodo: true, hay_anterior: true, rutas_evaluadas: 68, rutas_pequenas: 15, rutas_sin_historia: 5, rutas_fuera: 1, umbral_promedio: 161569.14, rutas: [RUTA],
};

const fuente: Fuente & Record<string, unknown> = {
  kpiPeriodo: async () => ({ venta_neta: 140170115, kg: 641341, precio_kg: 218.56, clientes_con_compra: 15867, venta_neta_cmp: 150549006.14, kg_cmp: 701088, precio_kg_cmp: 214.74, clientes_con_compra_cmp: 16100, rutas_con_venta: 2, rutas_total: 2 }),
  variacionPorDimension: async () => [],
  topContribuyentes: async () => [],
  serieMensual: async () => [],
  descomposicion: async () => ({
    actual: { venta_neta: 1, kg: 1, lineas: 1, clientes: 1, facturas: 1, facturas_por_cliente: 1, ticket_factura: 1, venta_por_cliente: 1 },
    anterior: { venta_neta: 1, kg: 1, lineas: 1, clientes: 1, facturas: 1, facturas_por_cliente: 1, ticket_factura: 1, venta_por_cliente: 1 },
  }),
  puentePrecioVolumenMezcla: async () => PUENTE,
  acumuladoAnio: async () => ACUMULADO,
  rutasAtipicas: async () => ATIPICAS,
};
const ctx = (over: Partial<Contexto["estado"]> = {}): Contexto => ({
  fuente, version, estado: { periodo: { anio: 2026, mes: 9 }, comparar: "anterior", filtros: {}, ...over },
});

describe("textos del análisis", () => {
  it("el puente lista volumen, precio, mezcla y solo los renglones que existen", () => {
    const pasos = pasosPuente(PUENTE, { anio: 2026, mes: 9 }, { anio: 2026, mes: 8 });
    expect(pasos.map((p) => p.clave)).toEqual(["volumen", "precio", "mezcla", "nuevos", "descontinuados", "sin_volumen"]);
    expect(pasos.reduce((s, p) => s + Math.round(p.valor * 100), 0)).toBe(Math.round(PUENTE.variacion * 100));
    const sinOtros = pasosPuente({ ...PUENTE, nuevos: 0, productos_nuevos: 0, descontinuados: 0, productos_descontinuados: 0, sin_volumen: 0 }, { anio: 2026, mes: 9 }, { anio: 2026, mes: 8 });
    expect(sinOtros.map((p) => p.clave)).toEqual(["volumen", "precio", "mezcla"]);
  });

  it("acumulado: rango y advertencias de meses parciales, faltantes y sin certificar", () => {
    expect(rangoAcumulado(2026, 9)).toBe("ene–sep 2026");
    expect(rangoAcumulado(2026, 1)).toBe("ene 2026");
    // ene–sep 2025 trae los meses sin certificar de S1; un tramo de 2027 contra 2026 ya no.
    expect(advertenciasAcumulado(ACUMULADO, meta.periodos)).toEqual([expect.stringMatching(/^El acumulado incluye meses sin certificar \(hasta junio 2025\)/)]);
    expect(advertenciasAcumulado({ ...ACUMULADO, anio: 2027, mes: 3, meses: [1, 2, 3], meses_cmp: [1, 2, 3] }, meta.periodos)).toEqual([]);
    const oct = advertenciasAcumulado({ ...ACUMULADO, mes: 10, meses: [...ACUMULADO.meses, 10], meses_cmp: [...ACUMULADO.meses_cmp, 10] }, meta.periodos);
    expect(oct.join(" ")).toMatch(/Octubre 2026 parcial: 12 días con venta, corte 15-oct-2026/);
    const sinBase = advertenciasAcumulado({ ...ACUMULADO, anio: 2025, meses_cmp: [] }, meta.periodos);
    expect(sinBase.join(" ")).toMatch(/ene–sep 2024 no tiene datos en esta versión: el acumulado se compara contra cero/);
    expect(sinBase.join(" ")).toMatch(/sin certificar/);
    const incompleto = advertenciasAcumulado({ ...ACUMULADO, meses_cmp: [3, 4, 5, 6, 7, 8, 9] }, meta.periodos);
    expect(incompleto.join(" ")).toMatch(/Ene–sep 2025 incompleto: sin datos de enero, febrero/);
  });

  it("rutas fuera de lo normal: motivo en palabras con el rango normal y el extremo de la historia", () => {
    const m = motivoAtipica(RUTA, { anio: 2026, mes: 8 });
    expect(m).toMatch(/^Subió \+363.2% vs. agosto 2026 \(\+L 2.0 M\)/);
    expect(m).toContain("entre −100.0% y +110.5%");
    expect(m).toContain("es su mayor subida en los 12 cambios anteriores (la más grande había sido +83.4%)");
    expect(motivoAtipica({ ...RUTA, cambio: -0.6, variacion: -330000, minimo: -0.1 }, { anio: 2026, mes: 8 })).toMatch(/^Cayó −60.0%.*la más grande había sido −10.0%/);
    expect(motivoAtipica({ ...RUTA, cambio: -0.6, minimo: 0.02 }, { anio: 2026, mes: 8 })).toMatch(/nunca había caído/);
  });
});

describe("herramientas del análisis", () => {
  it("se publican al modelo junto a las demás", () => {
    const nombres = herramientasModelo().map((d) => d.function.name);
    expect(nombres).toEqual(expect.arrayContaining(["puente_precio_volumen_mezcla", "acumulado_anio", "rutas_atipicas"]));
  });

  it("puente: hechos con cifras formateadas que pasan el verificador y sin datos de clientes", async () => {
    const r = await ejecutar("puente_precio_volumen_mezcla", { periodo: "2026-09", comparado: "2026-08" }, ctx(), "c1");
    expect(r.calculo).toBe("ventas.puente_precio_volumen_mezcla");
    expect(r.hechos[0]).toBe("La variación de venta neta septiembre 2026 vs. agosto 2026 fue −L 10.4 M (L 140.2 M vs. L 150.5 M) y se reparte así: volumen −L 13.0 M, precio −L 1.6 M, mezcla +L 3.7 M, productos nuevos +L 1.3 M, productos que dejaron de venderse −L 825.9 k, ajustes sin kg +L 187.");
    expect(r.hechos[1]).toMatch(/El efecto que más pesa es el de volumen \(−L 13.0 M\)\. En los 122 productos/);
    expect(r.hechos[2]).toBe("Mayor efecto precio: CAFE ORO 400G (−L 567.4 k; de L 264.22/kg a L 255.92/kg).");
    expect(r.visual).toMatchObject({ tipo: "tabla", columnas: ["Renglón", "Lempiras", "Qué mide"] });
    const ok = cifrasPermitidas([r.resumen, r.hechos]);
    expect(cifrasNoVerificadas("La caída de −L 10.4 M viene sobre todo del volumen (−L 13.0 M); la mezcla sumó +L 3.7 M.", ok)).toEqual([]);
    expect(JSON.stringify(r.resumen)).not.toMatch(/cliente_(codigo|nombre)|subgrupo/);
  });

  it("acumulado: tramo enero..mes contra el año anterior", async () => {
    const r = await ejecutar("acumulado_anio", { periodo: "2026-09" }, ctx(), "c1");
    expect(r).toMatchObject({ periodo: { anio: 2026, mes: 9 }, comparado: { anio: 2025, mes: 9 }, calculo: "ventas.acumulado_anio" });
    expect(r.hechos[0]).toBe("Acumulado ene–sep 2026: venta neta L 1,344.1 M vs. L 1,416.3 M en ene–sep 2025 (−L 72.1 M, −5.1%).");
    expect(r.hechos[1]).toContain("clientes con compra en el tramo 22,295 vs. 26,620 (−16.2%)");
    await expect(ejecutar("acumulado_anio", { periodo: "2024-05" }, ctx(), "c1")).rejects.toThrow(ErrorHerramienta);
  });

  it("rutas fuera de lo normal: resumen con el motivo de cada ruta", async () => {
    const r = await ejecutar("rutas_atipicas", { periodo: "2026-09" }, ctx(), "c1");
    expect(r.comparado).toEqual({ anio: 2026, mes: 8 });
    expect(r.hechos[0]).toBe("En septiembre 2026, 1 de 68 rutas evaluadas se salieron de lo normal contra agosto 2026.");
    expect(r.hechos[1]).toMatch(/^127 - EL PARAÍSO \(Mayoreo\): Subió \+363.2%/);
  });

  it("un doble sin las consultas de G9 falla con un error de herramienta", async () => {
    const viejo: Fuente = { kpiPeriodo: fuente.kpiPeriodo, variacionPorDimension: fuente.variacionPorDimension, topContribuyentes: fuente.topContribuyentes, serieMensual: fuente.serieMensual, descomposicion: fuente.descomposicion };
    await expect(ejecutar("acumulado_anio", { periodo: "2026-09" }, { ...ctx(), fuente: viejo }, "c1")).rejects.toThrow(/no está disponible/);
  });
});

describe("intérprete (modo automático)", () => {
  it.each([
    ["¿La caída fue por precio o por volumen?", "puente"],
    ["¿Cuánto pesó la mezcla?", "puente"],
    ["efecto precio en Mayoreo", "puente"],
    ["¿Bajó el precio en septiembre?", "puente"],
    ["¿Cómo vamos en lo que va del año?", "acumulado"],
    ["Acumulado de Mayoreo", "acumulado"],
    ["YTD de la marca ORO", "acumulado"],
    ["¿Qué rutas están fuera de lo normal?", "atipicas"],
    ["rutas atípicas de septiembre", "atipicas"],
    ["¿Cuál fue el precio promedio por kg?", "kpi"],
    ["¿Dónde se concentra la caída?", "diagnostico"],
  ])("%s → %s", (pregunta, tipo) => expect(interpretar(pregunta, ctx()).tipo).toBe(tipo));

  it("arma las llamadas de cada lectura", () => {
    expect(llamadas(interpretar("¿La caída fue por precio o por volumen?", ctx())).map((l) => l.herramienta)).toEqual(["kpi_periodo", "puente_precio_volumen_mezcla"]);
    expect(llamadas(interpretar("¿Qué productos bajaron de precio?", ctx())).map((l) => l.herramienta)).toEqual(["kpi_periodo", "puente_precio_volumen_mezcla", "variacion_por_dimension"]);
    expect(llamadas(interpretar("Acumulado de Mayoreo", ctx()))).toEqual([{ herramienta: "acumulado_anio", args: { periodo: "2026-09", filtros: { canal: "Mayoreo" } } }]);
    expect(llamadas(interpretar("rutas fuera de lo normal", ctx()))).toEqual([{ herramienta: "rutas_atipicas", args: { periodo: "2026-09", filtros: {}, limite: 10 } }]);
  });

  it("un acumulado que nombra solo el año llega al último mes con datos de ese año", () => {
    expect(interpretar("acumulado 2025", ctx()).periodo).toEqual({ anio: 2025, mes: 12 });
    expect(interpretar("acumulado a agosto", ctx()).periodo).toEqual({ anio: 2026, mes: 8 });
  });

  it("responde en modo automático con texto, hipótesis sin cifras y evidencia", async () => {
    const r = await responder("¿La caída fue por precio o por volumen?", [], ctx(), null);
    expect(r.modo).toBe("determinista");
    expect(r.texto).toContain("Por precio, volumen y mezcla: volumen −L 13.0 M, precio −L 1.6 M, mezcla +L 3.7 M");
    expect(r.texto).toContain("lo que más pesa es volumen (−L 13.0 M)");
    expect(r.hipotesis.join(" ")).toMatch(/sobre todo de kilos/);
    expect(r.hipotesis.join(" ")).not.toMatch(/\d/);
    expect(r.evidencia.calculo).toEqual(["ventas.kpi_periodo", "ventas.puente_precio_volumen_mezcla"]);

    const a = await responder("¿Cómo vamos en lo que va del año?", [], ctx(), null);
    expect(a.texto).toMatch(/^Acumulado ene–sep 2026: venta neta L 1,344.1 M/);
    const t = await responder("¿Qué rutas se salieron de lo normal?", [], ctx(), null);
    expect(t.texto).toContain("La que más se aleja es 127 - EL PARAÍSO (Mayoreo): Subió +363.2%");
    expect(t.hipotesis.join(" ")).toMatch(/pedido grande puntual/);
  });
});

// ------------------------------------------------------------------------------------------------------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

describe.skipIf(!url || !key)("análisis contra la versión publicada (Supabase local)", () => {
  let consultas: ReturnType<typeof crearConsultas>;
  let v: VersionVigente;
  beforeAll(async () => {
    const sb = createClient(url!, key!, { auth: { persistSession: false } });
    const rpc: Rpc = async (fn, args, schema) => {
      const { data, error } = await sb.schema("ventas").rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return schema.parse(data);
    };
    consultas = crearConsultas(rpc);
    v = (await consultas.versionVigente())!;
  });

  const centavos = (x: number) => Math.round(x * 100);

  it("el puente cuadra al centavo con la variación y con kpi_periodo", async () => {
    const ps = v.metadatos.periodos;
    const ultimo = ps.at(-1)!;
    const casos = [
      { periodo: ultimo, comparar: ps.at(-2)!, filtros: {} },
      { periodo: ultimo, comparar: { anio: ultimo.anio - 1, mes: ultimo.mes }, filtros: {} },
      { periodo: ps.at(-2)!, comparar: ps.at(-3)!, filtros: { canal: v.metadatos.canal[0] } },
      { periodo: ps.at(-2)!, comparar: ps.at(-3)!, filtros: { marca: v.metadatos.marca[0] } },
    ];
    for (const c of casos) {
      const req = { version: v.version, periodo: { anio: c.periodo.anio, mes: c.periodo.mes }, comparar: { anio: c.comparar.anio, mes: c.comparar.mes }, filtros: c.filtros };
      const [p, k] = await Promise.all([consultas.puentePrecioVolumenMezcla(req), consultas.kpiPeriodo(req)]);
      const suma = [p.volumen, p.precio, p.mezcla, p.nuevos, p.descontinuados, p.sin_volumen].reduce((s, x) => s + centavos(x), 0);
      expect(suma).toBe(centavos(p.variacion));
      expect(centavos(p.variacion)).toBe(centavos(p.venta_neta) - centavos(p.venta_neta_cmp));
      expect(centavos(p.venta_neta)).toBe(centavos(k.venta_neta));
      expect(centavos(p.venta_neta_cmp)).toBe(centavos(k.venta_neta_cmp));
      expect(JSON.stringify(p)).not.toMatch(/cliente|subgrupo/);
    }
  }, 60_000);

  it("el acumulado suma lo mismo que la serie mensual de los meses del tramo", async () => {
    const ultimo = v.metadatos.periodos.at(-1)!;
    const periodo = { anio: ultimo.anio, mes: ultimo.mes };
    const [a, serie, serieAnt] = await Promise.all([
      consultas.acumuladoAnio({ version: v.version, periodo, filtros: {} }),
      consultas.serieMensual({ version: v.version, anio: periodo.anio, filtros: {} }),
      consultas.serieMensual({ version: v.version, anio: periodo.anio - 1, filtros: {} }),
    ]);
    const tramo = (s: typeof serie) => s.filter((x) => x.mes <= periodo.mes).reduce((t, x) => t + centavos(x.venta_neta), 0);
    expect(centavos(a.venta_neta)).toBe(tramo(serie));
    expect(centavos(a.venta_neta_cmp)).toBe(tramo(serieAnt));
    expect(a.meses).toEqual(serie.filter((x) => x.mes <= periodo.mes).map((x) => x.mes));
    expect(a.clientes_con_compra).toBeGreaterThan(0);
  }, 60_000);

  it("rutas fuera de lo normal: cumplen la regla y traen todo lo que necesita el motivo", async () => {
    const ultimo = v.metadatos.periodos.at(-1)!;
    const r = await consultas.rutasAtipicas({ version: v.version, periodo: { anio: ultimo.anio, mes: ultimo.mes }, filtros: {}, limite: 50 });
    expect(r.hay_periodo).toBe(true);
    expect(r.rutas.length).toBe(r.rutas_fuera);
    for (const x of r.rutas) {
      expect(Math.abs(x.puntaje)).toBeGreaterThanOrEqual(3.5);
      expect(x.meses_historia).toBeGreaterThanOrEqual(6);
      expect(x.promedio_mensual).toBeGreaterThanOrEqual(r.umbral_promedio);
      expect(x.escala).toBeGreaterThanOrEqual(0.05);
      expect(motivoAtipica(x, { anio: ultimo.anio, mes: ultimo.mes })).toMatch(/^(Subió|Cayó) /);
    }
    const primero = await consultas.rutasAtipicas({ version: v.version, periodo: v.metadatos.periodos[0], filtros: {}, limite: 10 });
    expect(primero).toMatchObject({ hay_anterior: false, rutas: [] });
  }, 60_000);

  it.skipIf(!anon)("sin sesión no se puede llamar ninguna de las tres", async () => {
    const sb = createClient(url!, anon!, { auth: { persistSession: false } });
    const p = { p_version: v.version, p_anio: 2026, p_mes: 9, p_filtros: {} };
    for (const [fn, args] of [
      ["puente_precio_volumen_mezcla", { ...p, p_anio_cmp: 2026, p_mes_cmp: 8 }], ["acumulado_anio", p], ["rutas_atipicas", p],
    ] as const) {
      const { data, error } = await sb.schema("ventas").rpc(fn, args);
      expect(data).toBeNull();
      expect(error?.message).toMatch(/permission denied|acceso denegado/);
    }
  });
});
