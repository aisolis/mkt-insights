/**
 * G7: ciclo mensual. Alertas (unidad) y, contra el Supabase local, una carga mensual ficticia de octubre 2026:
 * ingesta desde Storage → alertas → publicar (reemplaza solo octubre) → retirar → vuelve la versión anterior.
 * Deja la base como estaba. Se salta si no hay service_role (CI sin base).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alertasCarga, esParcial } from "@/lib/cargas/alertas";
import { mesesParaAlertas } from "@/lib/cargas/composicion";
import { procesarCarga } from "@/lib/cargas/ingesta";
import { BUCKET_CARGAS, MIME_XLSX, type Mes } from "@/lib/cargas/tipos";
import { dias, xlsxDePrueba } from "./xlsx-prueba";

const mes = (anio: number, m: number, venta: number, over: Partial<Mes> = {}): Mes => ({
  anio, mes: m, filas: 1000, venta_neta: venta, kg: 10, dias: 26, ultimo_dia: `${anio}-${String(m).padStart(2, "0")}-28`,
  duplicados: 0, discrepancias: 0, canales_sin_homologar: [], ...over,
});

describe("alertas de carga", () => {
  const vigente = [mes(2026, 8, 150e6), mes(2026, 9, 140e6), mes(2026, 10, 74e6, { ultimo_dia: "2026-10-15" })];
  const hoy = "2026-11-05";

  it("mes que reemplaza con cambio grande: revisar; sin cambio: info", () => {
    const a = alertasCarga([mes(2026, 10, 150e6, { ultimo_dia: "2026-10-31" })], vigente, hoy);
    expect(a[0]).toMatchObject({ nivel: "revisar", texto: expect.stringMatching(/^Reemplaza octubre 2026: venta neta L 74\.0 M → L 150\.0 M \(\+102\.7%\)/) });
    const b = alertasCarga([mes(2026, 9, 140.5e6)], vigente, hoy);
    expect(b.find((x) => x.texto.startsWith("Reemplaza"))).toMatchObject({ nivel: "info" });
  });

  it("perder días de un mes ya publicado: revisar", () => {
    const a = alertasCarga([mes(2026, 10, 74e6, { ultimo_dia: "2026-10-10" })], vigente, hoy);
    expect(a.some((x) => x.nivel === "revisar" && /se perderían días/.test(x.texto))).toBe(true);
  });

  it("mes nuevo con salto > 30%, meses faltantes, canales sin homologar y duplicados", () => {
    const a = alertasCarga([mes(2026, 12, 20e6, { canales_sin_homologar: ["NUEVO CANAL"], duplicados: 50 })], vigente, "2027-01-10");
    const textos = a.filter((x) => x.nivel === "revisar").map((x) => x.texto).join(" | ");
    expect(textos).toMatch(/Faltan meses .*noviembre 2026/);
    expect(textos).toMatch(/canales sin homologar \(NUEVO CANAL\)/);
    expect(textos).toMatch(/50 filas repetidas/);
    const b = alertasCarga([mes(2026, 11, 50e6)], vigente, "2026-12-10");
    expect(b.some((x) => x.nivel === "revisar" && /noviembre 2026 es nuevo y cambia −32\.4% contra octubre 2026/.test(x.texto))).toBe(true);
  });

  it("fechas futuras bloquean; el último mes dice si es parcial", () => {
    expect(alertasCarga([mes(2026, 11, 1e6)], vigente, "2026-11-20")[0]).toMatchObject({ nivel: "bloqueo" });
    expect(esParcial(mes(2026, 10, 1, { ultimo_dia: "2026-10-15" }))).toBe(true);
    expect(esParcial(mes(2026, 10, 1, { ultimo_dia: "2026-10-30" }))).toBe(false);
    expect(esParcial(mes(2026, 2, 1, { ultimo_dia: "2026-02-27" }))).toBe(false);
  });

  it("hojas que no son del cubo: revisar", () => {
    expect(alertasCarga([mes(2026, 9, 140e6)], vigente, hoy, ["1. Resumen por canal"])[0]).toMatchObject({ nivel: "revisar", texto: expect.stringMatching(/«1\. Resumen por canal»/) });
  });

  it("archivo con toda la historia: lo avisa", () => {
    expect(alertasCarga(vigente, vigente, hoy).some((x) => /reemplaza toda la historia/.test(x.texto))).toBe(true);
  });
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!url || !service)("carga mensual contra el Supabase local", () => {
  let svc: SupabaseClient;
  let canal = "";
  let vigenteAntes = 0;
  const cargas: string[] = [], versiones: number[] = [];
  const kpi = async (version: number, anio: number, m: number) =>
    (await svc.schema("ventas").rpc("kpi_periodo", { p_version: version, p_anio: anio, p_mes: m, p_anio_cmp: anio, p_mes_cmp: m - 1 })).data;

  async function subir(nombre: string, bytes: Buffer) {
    const id = crypto.randomUUID(), ruta = `pruebas/${id}.xlsx`;
    const up = await svc.storage.from(BUCKET_CARGAS).upload(ruta, bytes, { contentType: MIME_XLSX });
    if (up.error) throw up.error;
    const ins = await svc.schema("ventas").from("carga").insert({ id, nombre_archivo: nombre, bytes: bytes.length, estado: "recibida", ruta_archivo: ruta });
    if (ins.error) throw ins.error;
    cargas.push(id);
    return id;
  }

  beforeAll(async () => {
    svc = createClient(url!, service!, opciones);
    const h = await svc.schema("ventas").from("homologacion").select("valor_origen").eq("dimension", "canal").limit(1).single();
    canal = h.data!.valor_origen;
    vigenteAntes = (await svc.schema("ventas").rpc("version_vigente")).data.version;
  });

  afterAll(async () => {
    if (versiones.length) await svc.schema("ventas").from("publicacion").delete().in("version", versiones);
    if (cargas.length) {
      await svc.storage.from(BUCKET_CARGAS).remove(cargas.map((id) => `pruebas/${id}.xlsx`));
      await svc.schema("ventas").from("carga").delete().in("id", cargas);
    }
  });

  it("rechaza un Excel con columnas distintas y deja la carga con su error", async () => {
    const id = await subir("columnas-malas.xlsx", await xlsxDePrueba([{ fecha: new Date(Date.UTC(2026, 9, 1)), canal, ventaNeta: 1 }], ["Fecha", "Ruta", "Otra"]));
    const r = await procesarCarga(svc, id);
    expect(r).toMatchObject({ estado: "con_errores", error: expect.stringMatching(/columna 3 debería ser «Empresa» y es «Otra»/) });
  });

  it("octubre completo: valida, alerta, publica reemplazando solo octubre y se retira", { timeout: 180_000 }, async () => {
    const filas = dias(2026, 10, 28).flatMap((fecha) => [{ fecha, canal, ventaNeta: 1000 }, { fecha, canal, ventaNeta: 500, duplicar: fecha.getUTCDate() === 1 }]);
    const archivo = await xlsxDePrueba(filas, undefined, true);
    const id = await subir("octubre-2026-prueba.xlsx", archivo);

    const r = await procesarCarga(svc, id);
    expect(r).toMatchObject({ estado: "validada", conteo: { cargadas: 57, duplicados: 1, desde: "2026-10-01", hasta: "2026-10-28", hojasIgnoradas: ["1. Resumen por canal"] } });
    const mismo = await subir("copia.xlsx", archivo);
    expect(await procesarCarga(svc, mismo)).toMatchObject({ estado: "con_errores", error: expect.stringMatching(/ya se cargó/) });

    const { porCarga, vigente } = await mesesParaAlertas(svc, [id]);
    expect(porCarga.get(id)).toEqual([expect.objectContaining({ anio: 2026, mes: 10, filas: 57, venta_neta: 42500, duplicados: 1 })]);
    const alertas = alertasCarga(porCarga.get(id)!, vigente, "2026-11-05");
    expect(alertas[0]).toMatchObject({ nivel: "revisar", texto: expect.stringMatching(/^Reemplaza octubre 2026/) });

    const septiembreAntes = await kpi(vigenteAntes, 2026, 9);
    const pub = await svc.schema("ventas").rpc("publicar", { p_carga: id, p_notas: "prueba automatizada", p_ultimo_mes_cerrado: true });
    expect(pub.error).toBeNull();
    const v = pub.data.version as number;
    versiones.push(v);
    expect(pub.data.meses_reemplazados).toEqual([expect.objectContaining({ anio: 2026, mes: 10 })]);
    expect(pub.data.fecha_corte).toBe("2026-10-28");

    const vig = (await svc.schema("ventas").rpc("version_vigente")).data;
    expect(vig.version).toBe(v);
    expect(vig.metadatos.periodos.at(-1)).toMatchObject({ anio: 2026, mes: 10, cerrado: true });
    expect((await kpi(v, 2026, 10)).venta_neta).toBe(42500);
    // Los demás meses no cambian (rutas_total sí: es de la versión y octubre trae otras rutas).
    expect({ ...(await kpi(v, 2026, 9)), rutas_total: 0 }).toEqual({ ...septiembreAntes, rutas_total: 0 });
    const serie = (await svc.schema("ventas").rpc("serie_mensual", { p_version: v, p_anio: 2026 })).data;
    expect(serie.at(-1)).toMatchObject({ mes: 10, venta_neta: 42500 });

    const ret = await svc.schema("ventas").rpc("retirar_version", { p_version: v, p_motivo: "prueba automatizada" });
    expect(ret.error).toBeNull();
    expect((await svc.schema("ventas").rpc("version_vigente")).data.version).toBe(vigenteAntes);
    // Solo con una única versión real se prueba el rechazo: si hay más, la llamada retiraría una versión real.
    if (vigenteAntes === 1) {
      const otra = await svc.schema("ventas").rpc("retirar_version", { p_version: vigenteAntes, p_motivo: "no se puede" });
      expect(otra.error?.message).toMatch(/única versión/);
    }
  });
});
