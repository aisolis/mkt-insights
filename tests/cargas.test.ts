/**
 * G7: ciclo mensual. Alertas (unidad) y, contra el Supabase local, una carga mensual ficticia de octubre 2026:
 * ingesta desde Storage → alertas → publicar (reemplaza solo octubre) → retirar → vuelve la versión anterior.
 * Deja la base como estaba. Se salta si no hay service_role (CI sin base).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alertasCarga, esParcial } from "@/lib/cargas/alertas";
import { camposVacios, ENCABEZADOS_CUBO } from "@/lib/cargas/columnas";
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
  let canalBia = "";
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
    const h = await svc.schema("ventas").from("homologacion").select("valor_origen, valor_homologado").eq("dimension", "canal").limit(1).single();
    canal = h.data!.valor_origen;
    canalBia = h.data!.valor_homologado;
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
    expect(r).toMatchObject({ estado: "con_errores", error: expect.stringMatching(/falta la columna de empresa \(se acepta como «Empresa»\).*Encabezados del archivo: «Fecha», «Ruta», «Otra»/) });
  });

  it("el error nombra la hoja de ventas a la que le falta una columna, no el resumen que viene antes", async () => {
    const archivo = await xlsxDePrueba([{ fecha: new Date(Date.UTC(2026, 9, 3)), canal, ventaNeta: 7 }], undefined, true, { renombrar: { Kg: "Kilos" } });
    const r = await procesarCarga(svc, await subir("kilos.xlsx", archivo));
    expect(r).toMatchObject({ estado: "con_errores", error: expect.stringMatching(/^Hoja «Hoja1» \(fila 1\): falta la columna de kilos \(se acepta como «Kg»\)/) });
  });

  it("columnas configurables: nombre nuevo, otro orden, opcional que falta y fila de encabezados (S26)", { timeout: 60_000 }, async () => {
    const ventas = svc.schema("ventas");
    const antes = (await ventas.from("columna_carga").select("campo, encabezados, obligatoria").in("campo", ["categoria", "sucursal"])).data!;
    const formatoAntes = (await ventas.from("formato_carga").select("fila_encabezado, hojas_excluidas").single()).data!;
    const ultimoCambio = (await ventas.from("columna_carga_cambio").select("id").order("id", { ascending: false }).limit(1).maybeSingle()).data?.id ?? 0;
    try {
      expect((await ventas.rpc("guardar_columna_carga", { p_campo: "categoria", p_encabezados: ["Café/Rep", " Datos café ", "DATOS CAFE", ""], p_obligatoria: true })).data)
        .toEqual({ accion: "editada", encabezados: ["Café/Rep", "Datos café"] });
      expect((await ventas.rpc("guardar_columna_carga", { p_campo: "sucursal", p_encabezados: ["Sucursal"], p_obligatoria: false })).error).toBeNull();
      expect((await ventas.rpc("guardar_formato_carga", { p_fila: 3, p_hojas: ["Desgloce"] })).error).toBeNull();
      // Un nombre no puede llenar dos campos, y los datos que necesita el dashboard no pueden faltar.
      expect((await ventas.rpc("guardar_columna_carga", { p_campo: "marca", p_encabezados: ["Marca", "datos-cafe"], p_obligatoria: true })).error?.message)
        .toMatch(/«Datos café» ya se usa para el campo categoria/);
      expect((await ventas.rpc("guardar_columna_carga", { p_campo: "venta_neta", p_encabezados: ["Venta Neta"], p_obligatoria: false })).error?.message)
        .toMatch(/no puede faltar/);
      expect((await ventas.from("columna_carga_cambio").select("tipo, campo").gt("id", ultimoCambio).order("id")).data)
        .toEqual([{ tipo: "columna", campo: "categoria" }, { tipo: "columna", campo: "sucursal" }, { tipo: "formato", campo: null }]);

      const columnas = [...ENCABEZADOS_CUBO].reverse().filter((c) => c !== "Sucursal");
      const archivo = await xlsxDePrueba([{ fecha: new Date(Date.UTC(2026, 9, 2)), canal, ventaNeta: 123 }], columnas, true,
        { renombrar: { "Café/Rep": "DATOS CAFÉ" }, titulo: [["Ventas BIA — octubre"], []] });
      const id = await subir("columnas-nuevas.xlsx", archivo);
      const r = await procesarCarga(svc, id);
      expect(r).toMatchObject({ estado: "validada", conteo: { cargadas: 1, hojasIgnoradas: ["1. Resumen por canal"] } });
      const fila = (await ventas.from("hecho").select("categoria, sucursal, venta_neta, canal_origen, fila_origen").eq("carga_id", id).single()).data;
      expect(fila).toEqual({ categoria: "Café", sucursal: "", venta_neta: 123, canal_origen: canal, fila_origen: 4 });
      const carga = (await ventas.from("carga").select("columnas").eq("id", id).single()).data!;
      expect(carga.columnas).toEqual([
        { hoja: "1. Resumen por canal", ignorada: expect.stringMatching(/no tiene encabezados en la fila 3/) },
        expect.objectContaining({ hoja: "Hoja1", faltan_opcionales: ["sucursal"], sin_usar: ["Mes Nom", "Año"], campos: expect.objectContaining({ categoria: "DATOS CAFÉ" }) }),
      ]);
      expect(camposVacios(carga.columnas)).toEqual(["«Sucursal»"]);
    } finally {
      for (const a of antes) await ventas.from("columna_carga").update({ encabezados: a.encabezados, obligatoria: a.obligatoria, actualizada_en: null, actualizada_por: null }).eq("campo", a.campo);
      await ventas.from("formato_carga").update({ ...formatoAntes, actualizada_en: null, actualizada_por: null }).eq("id", true);
      await ventas.from("columna_carga_cambio").delete().gt("id", ultimoCambio);
    }
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
    // Sin aprobación no se publica (V1-07).
    const sinAprobar = await svc.schema("ventas").rpc("publicar", { p_carga: id, p_notas: "prueba automatizada" });
    expect(sinAprobar.error?.message).toMatch(/no está aprobada/);
    const aprobarCon = (huella: string | null) => svc.schema("ventas").rpc("aprobar_carga", {
      p_carga: id, p_usuario: null, p_rol: "servicio", p_ultimo_mes_cerrado: true, p_alertas: [alertas[0].texto], p_motivo: "prueba automatizada de aprobación", p_huella: huella });
    // Aceptar alertas «Revisar» pide motivo, y una huella vieja (la carga cambió mientras se revisaba) se rechaza.
    const sinMotivo = await svc.schema("ventas").rpc("aprobar_carga", { p_carga: id, p_usuario: null, p_rol: "servicio", p_ultimo_mes_cerrado: true, p_alertas: ["x"], p_motivo: "corto" });
    expect(sinMotivo.error?.message).toMatch(/motivo/);
    expect((await aprobarCon("huella-vieja")).error?.message).toMatch(/cambió mientras se revisaba/);
    // Control de BI (V1-06): uno con un centavo de diferencia no coincide; el exacto sí, y cambia la huella.
    const huellaSinControl = (await svc.schema("ventas").rpc("huella_carga", { p_carga: id })).data as string;
    const control = (venta: number) => svc.schema("ventas").rpc("guardar_control", {
      p_carga: id, p_usuario: null, p_filas: [{ anio: 2026, mes: 10, canal: canalBia.toUpperCase(), venta_neta: venta }],
      p_meta: { nombre_archivo: "bi-octubre.csv", ruta_archivo: "pruebas/bi.csv", sha256: "x", custodio: "BI prueba", fecha_corte: "2026-10-28", nivel: ["canal"], medidas: ["venta_neta"] },
    });
    const c1 = await control(42500.01);
    expect((await svc.schema("ventas").rpc("comparar_control", { p_control: c1.data })).data).toMatchObject({ coincide: false, total_diferencias: 1 });
    const c2 = await control(42500);
    expect((await svc.schema("ventas").rpc("comparar_control", { p_control: c2.data })).data).toMatchObject({ coincide: true, cifras: 1 });
    const huella = (await svc.schema("ventas").rpc("huella_carga", { p_carga: id })).data as string;
    expect(huella).not.toBe(huellaSinControl);
    expect((await aprobarCon(huella)).error).toBeNull();
    const ap = (await svc.schema("ventas").rpc("aprobaciones", { p_cargas: [id] })).data;
    expect(ap).toEqual([expect.objectContaining({ carga_id: id, rol: "servicio", al_dia: true, alertas: [alertas[0].texto] })]);
    // Si la carga cambia después de aprobarla, la aprobación deja de valer y no se publica.
    await svc.schema("ventas").from("aprobacion_carga").update({ huella: "otra" }).eq("carga_id", id).is("anulada_en", null);
    expect((await svc.schema("ventas").rpc("publicar", { p_carga: id })).error?.message).toMatch(/cambió desde que se aprobó/);
    expect((await aprobarCon(huella)).error).toBeNull();
    const pub = await svc.schema("ventas").rpc("publicar", { p_carga: id, p_notas: "prueba automatizada", p_rol: "servicio" });
    expect(pub.error).toBeNull();
    const v = pub.data.version as number;
    versiones.push(v);
    expect(pub.data.meses_reemplazados).toEqual([expect.objectContaining({ anio: 2026, mes: 10 })]);
    expect(pub.data.fecha_corte).toBe("2026-10-28");

    const vig = (await svc.schema("ventas").rpc("version_vigente")).data;
    expect(vig.version).toBe(v);
    const fila = (await svc.schema("ventas").from("publicacion").select("aprobacion_id, rol_publicacion, ultimo_mes_cerrado").eq("version", v).single()).data;
    expect(fila?.aprobacion_id).toBeGreaterThan(ap[0].id); // la segunda aprobación, tras invalidar la primera
    expect(fila).toMatchObject({ rol_publicacion: "servicio", ultimo_mes_cerrado: true });
    // Coincide y el mes se aprobó completo: la base la deja conciliada contra ese control, sin nota a mano.
    expect(pub.data.conciliada_bi).toBe(true);
    const sello = (await svc.schema("ventas").from("publicacion").select("conciliada_bi, conciliada_nota, control_bi_id").eq("version", v).single()).data;
    expect(sello).toMatchObject({ conciliada_bi: true, control_bi_id: c2.data, conciliada_nota: expect.stringMatching(/^Control de BI «bi-octubre.csv» de BI prueba, corte 28-10-2026: 1 cifras iguales \(2026-10 por canal; venta neta\)$/) });
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
