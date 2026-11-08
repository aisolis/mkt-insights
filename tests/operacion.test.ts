/**
 * G9: operación mensual. Unidad: alertas de anomalías por canal, armado del resumen ejecutivo y correo (que en
 * pruebas nunca sale). Contra el Supabase local: homologación de canales con bitácora y re-aplicación a una carga
 * de prueba SIN publicar, con canales ficticios. No publica ni retira versiones y no toca datos publicados: crea
 * su propia carga y la descarta al final, junto con las equivalencias y la bitácora de los canales ficticios.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alertasCarga, UMBRAL_CANAL } from "@/lib/cargas/alertas";
import { canalesParaAlertas, mesesParaAlertas } from "@/lib/cargas/composicion";
import { procesarCarga } from "@/lib/cargas/ingesta";
import { armarResumen, correoResumen, datosResumen, type EntradaResumen, type VersionResumen } from "@/lib/cargas/resumen";
import { BUCKET_CARGAS, MIME_XLSX, type CanalMes, type Mes } from "@/lib/cargas/tipos";
import { crearConsultas, type Rpc } from "@/lib/semantic/consultas";
import type { Kpi } from "@/lib/semantic/contracts";
import { dias, xlsxDePrueba } from "./xlsx-prueba";

vi.mock("server-only", () => ({}));

const ultimo = (anio: number, m: number) => new Date(Date.UTC(anio, m, 0)).getUTCDate();
/** Mes completo (llega al último día) salvo que se diga otra cosa. */
const mes = (anio: number, m: number, venta: number, over: Partial<Mes> = {}): Mes => ({
  anio, mes: m, filas: 1000, venta_neta: venta, kg: 10, dias: 26, ultimo_dia: `${anio}-${String(m).padStart(2, "0")}-${ultimo(anio, m)}`,
  duplicados: 0, discrepancias: 0, canales_sin_homologar: [], ...over,
});
/** Canales de un mes a partir de { canal: venta }. */
const canales = (anio: number, m: number, v: Record<string, number>): CanalMes[] => Object.entries(v).map(([canal, venta_neta]) => ({ anio, mes: m, canal, venta_neta }));
const deCanales = (v: Record<string, number>) => Object.values(v).reduce((s, x) => s + x, 0);

describe("alertas de anomalías por canal", () => {
  const julio = { Detalle: 2.0e6, Mayoreo: 5e6, Moderno: 3e6, Gobierno: 0.05e6 };
  const agosto = { Detalle: 1.9e6, Mayoreo: 5e6, Moderno: 3e6, Gobierno: 0.05e6 };
  const septiembre = { Detalle: 1.8e6, Mayoreo: 5e6, Moderno: 3e6, Gobierno: 0.05e6, Institucional: 0.6e6 };
  const vigente = [mes(2026, 7, deCanales(julio)), mes(2026, 8, deCanales(agosto)), mes(2026, 9, deCanales(septiembre))];
  const canalesVigente = [...canales(2026, 7, julio), ...canales(2026, 8, agosto), ...canales(2026, 9, septiembre)];
  const hoy = "2026-11-05";

  it("mes nuevo: un canal que baja más del umbral frente al promedio de los 3 meses anteriores; los canales chicos se ignoran", () => {
    // Detalle: promedio 1.9 M → 1.178 M (−38 %). Gobierno (< 3 % del mes) se triplica y no alerta.
    const octubre = { Detalle: 1.178e6, Mayoreo: 5.2e6, Moderno: 3.1e6, Gobierno: 0.15e6, Institucional: 0.2e6 };
    const a = alertasCarga([mes(2026, 10, deCanales(octubre))], vigente, hoy, [], { carga: canales(2026, 10, octubre), vigente: canalesVigente });
    const textos = a.filter((x) => x.nivel === "revisar").map((x) => x.texto);
    expect(textos).toContain("Octubre 2026: Detalle baja 38 % frente al promedio de los 3 meses anteriores (L 1.2 M contra L 1.9 M).");
    expect(textos.some((t) => /Gobierno/.test(t))).toBe(false);
    expect(textos.some((t) => /Mayoreo|Moderno/.test(t))).toBe(false); // +4 % y +3 %: dentro del umbral
    // Institucional pesó 0.6 M solo en septiembre (promedio 0.2 M = 1.7 %) y ahora 0.2 M (2 %): chico, se ignora.
    expect(textos.some((t) => /Institucional/.test(t))).toBe(false);
  });

  it("canal que desaparece o que aparece con peso", () => {
    const octubre = { Mayoreo: 5e6, Moderno: 3e6, "SEMI PRUEBA": 1.5e6 };
    const a = alertasCarga([mes(2026, 10, deCanales(octubre))], vigente, hoy, [], { carga: canales(2026, 10, octubre), vigente: canalesVigente });
    const textos = a.map((x) => x.texto);
    expect(textos).toContain("Octubre 2026: Detalle no tiene ventas; el promedio de los 3 meses anteriores era L 1.9 M.");
    expect(textos.some((t) => t.startsWith("Octubre 2026: aparece SEMI PRUEBA con L 1.5 M (16 % del mes), sin ventas en los 3 meses anteriores."))).toBe(true);
  });

  it("mes que reemplaza uno publicado: umbral más estricto y solo con los mismos días", () => {
    const sept2 = { ...septiembre, Detalle: 2.0e6 }; // +11 %
    const a = alertasCarga([mes(2026, 9, deCanales(sept2))], vigente, hoy, [], { carga: canales(2026, 9, sept2), vigente: canalesVigente });
    expect(a.map((x) => x.texto)).toContain("Septiembre 2026: Detalle sube 11 % frente a lo publicado para ese mes (L 2.0 M contra L 1.8 M).");
    const casi = { ...septiembre, Detalle: 1.85e6 }; // +2.8 %: por debajo del umbral de reemplazo
    expect(UMBRAL_CANAL.reemplazo).toBeGreaterThan(2.8);
    const b = alertasCarga([mes(2026, 9, deCanales(casi))], vigente, hoy, [], { carga: canales(2026, 9, casi), vigente: canalesVigente });
    expect(b.some((x) => /Detalle sube/.test(x.texto))).toBe(false);
    // Si cambian los días, la alerta general ya lo dice: por canal no se compara.
    const c = alertasCarga([mes(2026, 9, deCanales(sept2), { ultimo_dia: "2026-09-20" })], vigente, hoy, [], { carga: canales(2026, 9, sept2), vigente: canalesVigente });
    expect(c.some((x) => /frente a lo publicado/.test(x.texto))).toBe(false);
  });

  it("un mes nuevo parcial no se compara por canal; sin datos de canales no hay alertas por canal", () => {
    const octubre = { Detalle: 0.5e6, Mayoreo: 2e6 };
    const parcial = mes(2026, 10, deCanales(octubre), { ultimo_dia: "2026-10-12" });
    const a = alertasCarga([parcial], vigente, hoy, [], { carga: canales(2026, 10, octubre), vigente: canalesVigente });
    expect(a.some((x) => /frente al promedio/.test(x.texto))).toBe(false);
    const b = alertasCarga([mes(2026, 10, deCanales(octubre))], vigente, hoy);
    expect(b.some((x) => /frente al promedio|no tiene ventas/.test(x.texto))).toBe(false);
  });

  it("con un solo mes completo de referencia lo nombra; un mes parcial publicado no entra al promedio", () => {
    const vig = [mes(2026, 8, deCanales(agosto), { ultimo_dia: "2026-08-15" }), mes(2026, 9, deCanales(septiembre))];
    const octubre = { ...septiembre, Mayoreo: 2.5e6 };
    const a = alertasCarga([mes(2026, 10, deCanales(octubre))], vig, hoy, [], { carga: canales(2026, 10, octubre), vigente: [...canales(2026, 8, agosto), ...canales(2026, 9, septiembre)] });
    expect(a.map((x) => x.texto)).toContain("Octubre 2026: Mayoreo baja 50 % frente a septiembre 2026 (L 2.5 M contra L 5.0 M).");
  });
});

// Resumen ejecutivo ------------------------------------------------------------------------------------------------
const kpi = (o: Partial<Kpi>): Kpi => ({
  venta_neta: 0, kg: 0, precio_kg: null, clientes_con_compra: 0, venta_neta_cmp: 0, kg_cmp: 0, precio_kg_cmp: null, clientes_con_compra_cmp: 0,
  rutas_con_venta: 0, rutas_total: 0, ...o,
});
const versionPrueba = (o: Partial<VersionResumen> = {}): VersionResumen => ({
  version: 7, fecha_corte: "2026-10-31", conciliada_bi: false, publicado_en: "2026-11-03T15:00:00Z", archivo: "octubre.xlsx", retirada_en: null, vigente: true,
  periodos: [
    { anio: 2025, mes: 10, dias: 26, ultimo_dia: "2025-10-31", cerrado: true },
    { anio: 2026, mes: 9, dias: 26, ultimo_dia: "2026-09-30", cerrado: true },
    { anio: 2026, mes: 10, dias: 26, ultimo_dia: "2026-10-31", cerrado: true },
    { anio: 2026, mes: 11, dias: 4, ultimo_dia: "2026-11-05", cerrado: false },
  ],
  ...o,
});
const fila = (valor: string, actual: number, anterior: number) => ({ valor, actual, anterior, variacion: actual - anterior });

describe("resumen ejecutivo: armado", () => {
  const base = { venta_neta: 140e6, kg: 2_000_000, precio_kg: 70, clientes_con_compra: 5000 };
  const entrada: EntradaResumen = {
    version: versionPrueba(),
    periodo: { anio: 2026, mes: 10 },
    kpiAnterior: kpi({ ...base, venta_neta_cmp: 150e6, kg_cmp: 2_100_000, precio_kg_cmp: 71.43, clientes_con_compra_cmp: 5100 }),
    kpiAnio: kpi({ ...base, venta_neta_cmp: 125e6, kg_cmp: 1_900_000, precio_kg_cmp: 65.79, clientes_con_compra_cmp: 4800 }),
    variaciones: {
      anterior: {
        canal: [fila("Detalle", 40e6, 48e6), fila("Mayoreo", 80e6, 79e6), fila("Moderno", 20e6, 23e6), fila("Gobierno", 0, 0)],
        ruta: [fila("101", 5e6, 7e6), fila("102", 3e6, 2.5e6)],
        marca: [fila("Marca Prueba", 10e6, 12e6)],
      },
      anio: { canal: [fila("Detalle <B&C>", 40e6, 30e6), fila("Mayoreo", 80e6, 75e6), fila("Moderno", 20e6, 20e6)], ruta: [], marca: [] },
    },
  };

  it("indicadores contra el mes anterior y el mismo mes del año anterior, y titular en lenguaje simple", () => {
    const r = armarResumen(entrada);
    expect(r.anterior).toEqual({ anio: 2026, mes: 9 });
    expect(r.anioAnterior).toEqual({ anio: 2025, mes: 10 });
    expect(r.indicadores.map((i) => i.clave)).toEqual(["venta_neta", "kg", "precio_kg", "clientes_con_compra"]);
    const vn = r.indicadores[0];
    expect(vn.pctAnterior).toBeCloseTo(-6.667, 2);
    expect(vn.pctAnio).toBeCloseTo(12, 5);
    expect(r.titular).toBe("Octubre 2026: venta neta de L 140.0 M, −6.7 % frente a septiembre 2026 y +12.0 % frente a octubre 2025.");
  });

  it("qué explica la variación: ordenado por tamaño, con su peso sobre el total y sin filas sin cambio", () => {
    const r = armarResumen(entrada);
    const [anterior, anio] = r.explicaciones;
    expect(anterior.total).toBe(-10e6);
    const canal = anterior.dimensiones.find((d) => d.dimension === "canal")!;
    expect(canal.filas.map((f) => f.valor)).toEqual(["Detalle", "Moderno", "Mayoreo"]); // Gobierno no cambió
    expect(canal.filas[0].peso).toBeCloseTo(-80, 5);
    expect(anio.dimensiones[0].filas[0]).toMatchObject({ valor: "Detalle <B&C>", variacion: 10e6 });
  });

  it("advertencias: sin conciliar con BI, versión retirada y mes parcial", () => {
    const r = armarResumen(entrada);
    expect(r.avisos).toContain("La versión v7 no está conciliada con BI: confirma las cifras con el reporte de BI antes de comunicarlas.");
    const retirada = armarResumen({ ...entrada, version: versionPrueba({ retirada_en: "2026-11-04T18:00:00Z", vigente: false }) });
    expect(retirada.avisos[0]).toMatch(/^La versión v7 fue retirada el 04-nov-2026/);
    const parcial = armarResumen({ ...entrada, periodo: { anio: 2026, mes: 11 } });
    expect(parcial.avisos.some((a) => /^Noviembre 2026 parcial: 4 días con venta, corte 05-nov-2026/.test(a))).toBe(true);
    expect(parcial.avisos.some((a) => /Noviembre 2025 no tiene datos en esta versión/.test(a))).toBe(true);
  });

  it("correo: escapa el HTML y lleva el enlace", () => {
    const r = armarResumen({ ...entrada, variaciones: { ...entrada.variaciones, anterior: entrada.variaciones.anio } });
    const c = correoResumen(r, "https://bia.example/resumen?version=7&periodo=2026-10");
    expect(c.asunto).toBe("BIA Foresight · Resumen de octubre 2026 (versión v7)");
    expect(c.html).toContain('href="https://bia.example/resumen?version=7&amp;periodo=2026-10"');
    expect(c.texto).toContain("Venta neta: L 140.0 M (−6.7 % vs. septiembre 2026; +12.0 % vs. octubre 2025)");
    expect(c.html).toContain("Detalle &lt;B&amp;C&gt; (+L 10.0 M)");
    expect(c.html).not.toContain("<B&C>");
  });
});

describe("correo", () => {
  it("fuera de producción no llama a Resend y lo dice", async () => {
    const { enviarCorreo } = await import("@/lib/correo");
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(process.env.NODE_ENV).not.toBe("production");
      const r = await enviarCorreo({ para: ["a@prueba.test", "A@prueba.test", "no-es-correo"], asunto: "Prueba", html: "<p>x</p>", texto: "x" });
      expect(r).toEqual({ estado: "desarrollo", destinatarios: 1 });
      expect(fetchFalso).not.toHaveBeenCalled();
      expect(log.mock.calls[0][0]).toMatch(/En desarrollo no se envían correos/);
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
    }
  });
});

// Contra el Supabase local -----------------------------------------------------------------------------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
/** Canales ficticios: nunca coinciden con canales reales del cubo (SEMI-MAYOREO, PENDIENTE siguen sin decidirse). */
const FALSO_A = "ZZ PRUEBA OPERACION A", FALSO_B = "ZZ PRUEBA OPERACION B";

describe.skipIf(!url || !service)("homologación y resumen contra el Supabase local", () => {
  let svc: SupabaseClient;
  let carga = "";
  let publicadoAntes: unknown;

  const limpiarFalsos = async () => {
    await svc.schema("ventas").from("homologacion").delete().eq("dimension", "canal").in("valor_origen", [FALSO_A, FALSO_B]);
    await svc.schema("ventas").from("homologacion_cambio").delete().in("valor_origen", [FALSO_A, FALSO_B]);
  };
  /** Lo publicado (meses de las cargas publicadas y su resumen por canal) para comprobar que no cambia. */
  const fotoPublicado = async () => {
    const pub = (await svc.schema("ventas").from("publicacion").select("carga_id")).data!.map((p) => p.carga_id as string);
    const meses = (await svc.schema("ventas").from("carga_mes").select("*").in("carga_id", pub).order("carga_id").order("anio").order("mes")).data;
    const cargas = (await svc.schema("ventas").from("carga").select("id, estado").in("id", pub).order("id")).data;
    const resumen = await svc.schema("ventas").from("resumen_mensual").select("*", { count: "exact", head: true }).in("carga_id", pub);
    return { meses, cargas, resumen: resumen.count };
  };
  const canalesDe = async (origen: string) =>
    [...new Set(((await svc.schema("ventas").from("hecho").select("canal").eq("carga_id", carga).eq("canal_origen", origen)).data ?? []).map((f) => f.canal))];
  const sinHomologar = async () =>
    ((await svc.schema("ventas").from("carga_mes").select("canales_sin_homologar").eq("carga_id", carga).single()).data!.canales_sin_homologar as string[]).sort();
  const bitacora = async (origen: string) =>
    (await svc.schema("ventas").from("homologacion_cambio").select("accion, antes, despues, cargas_actualizadas").eq("valor_origen", origen).order("id")).data!;
  const guardar = (origen: string, canal: string) => svc.schema("ventas").rpc("guardar_homologacion_canal", { p_origen: origen, p_homologado: canal, p_usuario: null });

  beforeAll(async () => {
    svc = createClient(url!, service!, opciones);
    await limpiarFalsos(); // restos de una corrida anterior que falló
    publicadoAntes = await fotoPublicado();
    // Carga de prueba de septiembre 2026: 20 filas de A y 10 de B. Se valida y NUNCA se publica.
    const filas = dias(2026, 9, 10).flatMap((fecha) => [
      { fecha, canal: FALSO_A, ventaNeta: 1000 }, { fecha, canal: FALSO_A, ventaNeta: 250 }, { fecha, canal: FALSO_B, ventaNeta: 400 },
    ]);
    const bytes = await xlsxDePrueba(filas);
    carga = crypto.randomUUID();
    const ruta = `pruebas/${carga}.xlsx`;
    const up = await svc.storage.from(BUCKET_CARGAS).upload(ruta, bytes, { contentType: MIME_XLSX });
    if (up.error) throw up.error;
    const ins = await svc.schema("ventas").from("carga").insert({ id: carga, nombre_archivo: "operacion-prueba.xlsx", bytes: bytes.length, estado: "recibida", ruta_archivo: ruta });
    if (ins.error) throw ins.error;
    expect(await procesarCarga(svc, carga)).toMatchObject({ estado: "validada", conteo: { cargadas: 30 } });
  }, 120_000);

  afterAll(async () => {
    await limpiarFalsos();
    if (carga) {
      await svc.storage.from(BUCKET_CARGAS).remove([`pruebas/${carga}.xlsx`]);
      await svc.schema("ventas").from("carga").delete().eq("id", carga).neq("estado", "publicada");
    }
  });

  it("homologar un canal actualiza la carga sin publicar, sus alertas y deja la bitácora", { timeout: 60_000 }, async () => {
    expect(await sinHomologar()).toEqual([FALSO_A, FALSO_B]);
    const pendientes = (await svc.schema("ventas").rpc("canales_pendientes_homologar")).data as { canal_origen: string; carga_id: string; filas: number }[];
    expect(pendientes.filter((p) => p.carga_id === carga).map((p) => [p.canal_origen, p.filas])).toEqual([[FALSO_A, 20], [FALSO_B, 10]]);

    const r = await guardar(FALSO_A, "Detalle");
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ accion: "creada", cargas_actualizadas: [{ carga_id: carga, archivo: "operacion-prueba.xlsx", filas: 20 }] });
    expect(await canalesDe(FALSO_A)).toEqual(["Detalle"]);
    expect(await canalesDe(FALSO_B)).toEqual([FALSO_B]);
    expect(await sinHomologar()).toEqual([FALSO_B]);
    const resumen = (await svc.schema("ventas").from("resumen_mensual").select("canal, venta_neta").eq("carga_id", carga)).data!;
    expect(resumen.filter((f) => f.canal === "Detalle").reduce((s, f) => s + Number(f.venta_neta), 0)).toBe(12500);

    // Las alertas de la carga ya no piden homologar A, sí B; los totales por canal ya vienen homologados.
    const { porCarga, vigente } = await mesesParaAlertas(svc, [carga]);
    const porCanal = await canalesParaAlertas(svc, [carga]);
    expect(porCanal.get(carga)!.carga.map((c) => c.canal).sort()).toEqual(["Detalle", FALSO_B]);
    const alertas = alertasCarga(porCarga.get(carga)!, vigente, "2026-11-05", [], porCanal.get(carga));
    const sobreCanales = alertas.find((a) => /canales sin homologar/.test(a.texto))!;
    expect(sobreCanales.texto).toContain(FALSO_B);
    expect(sobreCanales.texto).not.toContain(FALSO_A);

    expect(await bitacora(FALSO_A)).toEqual([expect.objectContaining({ accion: "creada", antes: null, despues: { valor_homologado: "Detalle", revisar: false } })]);
    const pend2 = (await svc.schema("ventas").rpc("canales_pendientes_homologar")).data as { canal_origen: string; carga_id: string }[];
    expect(pend2.filter((p) => p.carga_id === carga).map((p) => p.canal_origen)).toEqual([FALSO_B]);
  });

  it("cambiar y quitar la equivalencia se re-aplica; repetir no hace nada", { timeout: 60_000 }, async () => {
    expect((await guardar(FALSO_A, "Mayoreo")).data).toMatchObject({ accion: "editada", cargas_actualizadas: [{ carga_id: carga, filas: 20 }] });
    expect(await canalesDe(FALSO_A)).toEqual(["Mayoreo"]);
    expect((await guardar(FALSO_A, "Mayoreo")).data).toEqual({ accion: "sin_cambios", cargas_actualizadas: [] });

    const quitar = await svc.schema("ventas").rpc("eliminar_homologacion_canal", { p_origen: FALSO_A, p_usuario: null });
    expect(quitar.data).toMatchObject({ accion: "eliminada", cargas_actualizadas: [{ carga_id: carga, filas: 20 }] });
    expect(await canalesDe(FALSO_A)).toEqual([FALSO_A]);
    expect(await sinHomologar()).toEqual([FALSO_A, FALSO_B]);
    expect((await bitacora(FALSO_A)).map((b) => [b.accion, b.antes?.valor_homologado ?? null, b.despues?.valor_homologado ?? null])).toEqual([
      ["creada", null, "Detalle"], ["editada", "Detalle", "Mayoreo"], ["eliminada", "Mayoreo", null],
    ]);
    const otraVez = await svc.schema("ventas").rpc("eliminar_homologacion_canal", { p_origen: FALSO_A, p_usuario: null });
    expect(otraVez.error?.message).toMatch(/ya no existe/);
    expect((await guardar("x", "  ")).error?.message).toMatch(/Indica el canal BIA/);
  });

  it("una carga que no está 'validada' no se toca", { timeout: 60_000 }, async () => {
    await svc.schema("ventas").from("carga").update({ estado: "procesando" }).eq("id", carga);
    try {
      expect((await guardar(FALSO_B, "Detalle")).data).toEqual({ accion: "creada", cargas_actualizadas: [] });
      expect(await canalesDe(FALSO_B)).toEqual([FALSO_B]);
    } finally {
      await svc.schema("ventas").from("carga").update({ estado: "validada" }).eq("id", carga);
    }
    expect((await svc.schema("ventas").rpc("eliminar_homologacion_canal", { p_origen: FALSO_B, p_usuario: null })).data)
      .toMatchObject({ accion: "eliminada", cargas_actualizadas: [{ carga_id: carga, filas: 0 }] });
  });

  it("lo publicado no cambió", async () => {
    expect(await fotoPublicado()).toEqual(publicadoAntes);
  });

  it("resumen de la versión vigente con las funciones del contrato (solo lectura)", { timeout: 60_000 }, async () => {
    const rpc: Rpc = async (fn, args, schema) => {
      const { data, error } = await svc.schema("ventas").rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return schema.parse(data);
    };
    const c = crearConsultas(rpc);
    const version = async (n: number | null) => (await svc.schema("ventas").rpc("version_publicada", { p_version: n })).data as VersionResumen | null;
    const r = await datosResumen({ version, kpiPeriodo: c.kpiPeriodo, variacionPorDimension: c.variacionPorDimension }, {});
    expect(r).not.toBeNull();
    const vig = (await svc.schema("ventas").rpc("version_vigente")).data;
    expect(r!.version.version).toBe(vig.version);
    expect(r!.version.vigente).toBe(true);
    const cerrado = vig.metadatos.periodos.findLast((p: { cerrado: boolean }) => p.cerrado);
    expect(r!.periodo).toEqual({ anio: cerrado.anio, mes: cerrado.mes });
    const directo = await c.kpiPeriodo({ version: vig.version, periodo: r!.periodo, comparar: r!.anterior, filtros: {} });
    expect(r!.indicadores[0].valor).toBe(directo.venta_neta);
    expect(r!.indicadores[0].anterior).toBe(directo.venta_neta_cmp);
    // La variación por canal suma lo mismo que la diferencia de venta neta.
    expect(r!.explicaciones[0].total).toBeCloseTo(directo.venta_neta - directo.venta_neta_cmp, 2);
    expect(await version(99999)).toBeNull();
    const otro = await datosResumen({ version, kpiPeriodo: c.kpiPeriodo, variacionPorDimension: c.variacionPorDimension }, { version: "99999" });
    expect(otro).toBeNull();
  });
});
