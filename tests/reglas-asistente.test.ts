/**
 * G8: reglas del asistente. Unitarias: bloqueos (reglaBloqueo), inyección en las instrucciones de sistema y vista
 * previa. Integración contra el Supabase local (0011_reglas_asistente.sql): alta, activar/desactivar, edición y
 * eliminación con las funciones del servidor, y su bitácora. Borra las filas que crea. La parte con base se salta
 * si no hay service_role (CI sin base).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { reglaBloqueo } from "@/lib/asistente/alcance";
import { sistema } from "@/lib/asistente/modelo";
import { responder } from "@/lib/asistente/responder";
import type { Contexto, Fuente, ReglaAsistente } from "@/lib/asistente/tipos";
import type { VersionVigente } from "@/lib/semantic/contracts";

// reglas-servidor es solo de servidor; en las pruebas no hay React Server Components.
vi.mock("server-only", () => ({}));
const { activarRegla, crearRegla, editarRegla, eliminarRegla, EntradaRegla, listarReglas, normalizarTerminos, reglasActivas, seccionReglas } =
  await import("@/lib/asistente/reglas-servidor");

const regla = (tipo: ReglaAsistente["tipo"], texto: string, terminos: string[] = []): ReglaAsistente => ({ id: `${tipo}-${texto.length}`, tipo, texto, terminos });
const COMPETENCIA = regla("bloqueo", "Los precios de la competencia no están en los datos de venta; pídelos a Insights.", ["precio de la competencia", "márgenes por cliente"]);

describe("reglaBloqueo", () => {
  it("compara sin tildes ni mayúsculas y responde con el mensaje de la regla, sin documentos", () => {
    expect(reglaBloqueo("¿Cuál es el PRECIO de la Competéncia en Mayoreo?", [COMPETENCIA])).toEqual({ motivo: COMPETENCIA.texto, documentos: false });
    expect(reglaBloqueo("dame los margenes por cliente", [COMPETENCIA])).not.toBeNull();
    expect(reglaBloqueo("precio de la competencia?", [COMPETENCIA])).not.toBeNull();
  });

  it("solo palabras o frases completas", () => {
    const precio = regla("bloqueo", "No hablamos de precios.", ["precio"]);
    expect(reglaBloqueo("¿Cómo van los precios?", [precio])).toBeNull();
    expect(reglaBloqueo("¿Subió el precio?", [precio])).not.toBeNull();
    const ruta = regla("bloqueo", "Esa ruta no se consulta.", ["ruta 12"]);
    expect(reglaBloqueo("¿Qué pasó en la ruta 127?", [ruta])).toBeNull();
    expect(reglaBloqueo("¿Qué pasó en la ruta 12?", [ruta])).not.toBeNull();
    expect(reglaBloqueo("¿Cuál es el precio de la competencia directa?", [COMPETENCIA])).not.toBeNull();
    expect(reglaBloqueo("precio de la", [COMPETENCIA])).toBeNull();
  });

  it("ignora instrucciones y definiciones aunque traigan términos, y no bloquea sin reglas", () => {
    const otras = [regla("instruccion", "Habla de la competencia con cuidado.", ["competencia"]), regla("definicion", "Ticket = venta neta / facturas.", ["ticket"])];
    expect(reglaBloqueo("¿Cómo está la competencia y el ticket?", otras)).toBeNull();
    expect(reglaBloqueo("¿Cómo está la competencia?", [])).toBeNull();
    expect(reglaBloqueo("¿Cómo está la competencia?")).toBeNull();
  });

  it("con varios bloqueos usa el primero que coincide", () => {
    const otro = regla("bloqueo", "Otro motivo.", ["competencia"]);
    expect(reglaBloqueo("precio de la competencia", [otro, COMPETENCIA])?.motivo).toBe("Otro motivo.");
  });
});

const meta: VersionVigente["metadatos"] = {
  periodos: [
    { anio: 2026, mes: 8, dias: 26, ultimo_dia: "2026-08-31", cerrado: true },
    { anio: 2026, mes: 9, dias: 26, ultimo_dia: "2026-09-30", cerrado: true },
  ],
  canal: ["Detalle", "Mayoreo", "Moderno"], ruta: ["127 - EL PARAÍSO"], marca: ["ORO"],
  producto: [{ codigo: "1001", descripcion: "CAFE ORO 400G" }], rutas_total: 1,
};
const version: VersionVigente = { version: 1, fecha_corte: "2026-09-30", conciliada_bi: false, publicado_en: "2026-10-01T00:00:00Z", archivo: "prueba.xlsx", metadatos: meta };
const fuente: Fuente = {
  kpiPeriodo: vi.fn(async () => ({ venta_neta: 90, kg: 9, precio_kg: 10, clientes_con_compra: 50, venta_neta_cmp: 100, kg_cmp: 10, precio_kg_cmp: 10, clientes_con_compra_cmp: 48, rutas_con_venta: 1, rutas_total: 1 })),
  variacionPorDimension: vi.fn(async () => []),
  topContribuyentes: vi.fn(async () => []),
  serieMensual: vi.fn(async () => []),
  descomposicion: vi.fn(async () => ({
    actual: { venta_neta: 90, kg: 9, lineas: 10, clientes: 50, facturas: 100, facturas_por_cliente: 2, ticket_factura: 0.9, venta_por_cliente: 1.8 },
    anterior: { venta_neta: 100, kg: 10, lineas: 10, clientes: 48, facturas: 101, facturas_por_cliente: 2.1, ticket_factura: 0.99, venta_por_cliente: 2.08 },
  })),
};
const ctx = (reglas?: ReglaAsistente[]): Contexto => ({ fuente, version, estado: { periodo: { anio: 2026, mes: 9 }, comparar: "anterior", filtros: {} }, reglas });

describe("sistema(): reglas en las instrucciones", () => {
  const DEF = regla("definicion", "Ticket = venta neta / facturas.");
  const INS = regla("instruccion", "Cuando hables de Moderno, aclara que incluye supermercados y cadenas.");

  it("incluye definiciones e instrucciones antes de las reglas numeradas; los bloqueos no van al modelo", () => {
    const s = sistema(ctx([DEF, INS, COMPETENCIA]));
    expect(s).toContain(`- ${DEF.texto}`);
    expect(s).toContain(`- ${INS.texto}`);
    expect(s.indexOf(DEF.texto)).toBeLessThan(s.indexOf("Reglas:"));
    expect(s.indexOf(INS.texto)).toBeLessThan(s.indexOf("Reglas:"));
    expect(s).toMatch(/mandan las reglas numeradas/);
    expect(s).not.toContain(COMPETENCIA.texto);
    expect(s).not.toContain("precio de la competencia");
  });

  it("sin reglas no agrega nada", () => {
    expect(sistema(ctx([]))).toBe(sistema(ctx()));
    expect(sistema(ctx())).not.toMatch(/Definiciones de BIA|Indicaciones del equipo/);
    expect(sistema(ctx([COMPETENCIA]))).toBe(sistema(ctx()));
  });

  it("la vista previa son exactamente las líneas que las reglas agregan", () => {
    const lineas = seccionReglas([DEF, INS, COMPETENCIA]);
    expect(lineas).toHaveLength(4);
    expect(lineas[1]).toBe(`- ${DEF.texto}`);
    expect(lineas[3]).toBe(`- ${INS.texto}`);
    for (const l of lineas) expect(sistema(ctx([DEF, INS]))).toContain(l);
    expect(seccionReglas([])).toEqual([]);
    expect(seccionReglas([COMPETENCIA])).toEqual([]);
  });
});

describe("responder() con un bloqueo", () => {
  it("bloquea antes de consultar datos, de buscar documentos y de llamar al modelo", async () => {
    const documentos = vi.fn(async () => []);
    const fetch = vi.fn<typeof globalThis.fetch>();
    // "competencia" también es tema fijo fuera de alcance (con documentos): el bloqueo del admin va primero.
    const r = await responder("¿Cuál es el precio de la competencia en Mayoreo?", [], { ...ctx([COMPETENCIA]), documentos }, { apiKey: "test", modelo: "m", fetch });
    expect(r).toMatchObject({ estado: "fuera_de_alcance", hechos: [], visuales: [], consultas: [], contexto: [] });
    expect(r.texto).toBe(`No puedo responder eso. ${COMPETENCIA.texto}`);
    for (const f of Object.values(fuente)) expect(f).not.toHaveBeenCalled();
    expect(documentos).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("si la pregunta no trae los términos, responde normal", async () => {
    const r = await responder("¿Cuánto vendimos en septiembre 2026?", [], ctx([COMPETENCIA]), null);
    expect(r.estado).toBe("ok");
    expect(fuente.kpiPeriodo).toHaveBeenCalled();
  });
});

describe("validación de reglas", () => {
  it("limpia términos: signos, espacios, vacíos y repetidos sin tildes ni mayúsculas", () => {
    expect(normalizarTerminos(["  ¿Precio de la  competencia? ", "", "precio de la competéncia", "Márgenes", "margenes", " , "])).toEqual(["Precio de la competencia", "Márgenes"]);
  });

  it("un bloqueo necesita términos; los demás tipos no los guardan", () => {
    expect(EntradaRegla.safeParse({ tipo: "bloqueo", texto: "No respondemos eso.", terminos: [" ", ""] }).success).toBe(false);
    expect(EntradaRegla.parse({ tipo: "instruccion", texto: "  Sé breve.  ", terminos: ["x"] })).toEqual({ tipo: "instruccion", texto: "Sé breve.", terminos: [] });
    expect(EntradaRegla.safeParse({ tipo: "definicion", texto: "ab" }).success).toBe(false);
    expect(EntradaRegla.safeParse({ tipo: "definicion", texto: "x".repeat(501) }).success).toBe(false);
    expect(EntradaRegla.safeParse({ tipo: "otro", texto: "Algo válido." }).success).toBe(false);
  });
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !service)("reglas en la base (servidor)", () => {
  let svc: SupabaseClient;
  const creadas: string[] = [];
  const marca = `prueba_g8_${Date.now()}`; // sin guiones: los guiones separan palabras en los bloqueos

  const cambios = async (id: string) => {
    const { data, error } = await svc.schema("ventas").from("regla_asistente_cambio").select("accion, antes, despues, usuario_id").eq("regla_id", id).order("id");
    if (error) throw error;
    return data;
  };

  beforeAll(() => {
    svc = createClient(url!, service!, { auth: { persistSession: false, autoRefreshToken: false } });
  });

  afterAll(async () => {
    if (!creadas.length) return;
    await svc.schema("ventas").from("regla_asistente").delete().in("id", creadas);
    await svc.schema("ventas").from("regla_asistente_cambio").delete().in("regla_id", creadas);
  });

  it("alta, desactivar, editar, activar y eliminar, con su bitácora", async () => {
    const def = await crearRegla({ tipo: "definicion", texto: `Ticket = venta neta / facturas (${marca}).` }, null);
    const blo = await crearRegla({ tipo: "bloqueo", texto: `No respondemos eso (${marca}).`, terminos: [`${marca} uno`, ` ${marca.toUpperCase()} UNO `, "", `${marca} dos`] }, null);
    expect(def.error).toBeUndefined();
    expect(blo.error).toBeUndefined();
    creadas.push(def.id!, blo.id!);

    // Solo activas, con los términos ya limpios.
    let activas = (await reglasActivas()).filter((r) => creadas.includes(r.id));
    expect(activas.map((r) => r.tipo).sort()).toEqual(["bloqueo", "definicion"]);
    expect(activas.find((r) => r.id === blo.id)?.terminos).toEqual([`${marca} uno`, `${marca} dos`]);
    expect(activas.find((r) => r.id === def.id)?.terminos).toEqual([]);

    expect(await activarRegla(def.id!, false, null)).toEqual({ id: def.id });
    activas = (await reglasActivas()).filter((r) => creadas.includes(r.id));
    expect(activas.map((r) => r.id)).toEqual([blo.id]);
    // Desactivar algo ya inactivo no deja otra fila en la bitácora.
    await activarRegla(def.id!, false, null);

    expect(await editarRegla(def.id!, { tipo: "instruccion", texto: `Aclara que Moderno incluye supermercados (${marca}).` }, null)).toEqual({ id: def.id });
    expect(await activarRegla(def.id!, true, null)).toEqual({ id: def.id });
    activas = (await reglasActivas()).filter((r) => creadas.includes(r.id));
    expect(activas.find((r) => r.id === def.id)).toMatchObject({ tipo: "instruccion", texto: `Aclara que Moderno incluye supermercados (${marca}).` });

    const fila = (await listarReglas()).find((r) => r.id === def.id);
    expect(fila).toMatchObject({ activa: true, tipo: "instruccion" });

    expect(await eliminarRegla(blo.id!, null)).toEqual({ id: blo.id });
    expect((await reglasActivas()).some((r) => r.id === blo.id)).toBe(false);
    expect((await eliminarRegla(blo.id!, null)).error).toMatch(/ya no existe/);

    expect((await cambios(def.id!)).map((c) => c.accion)).toEqual(["creada", "desactivada", "editada", "activada"]);
    const [creada, , editada] = await cambios(def.id!);
    expect(creada).toMatchObject({ antes: null, despues: { tipo: "definicion", activa: true } });
    expect(editada).toMatchObject({ antes: { tipo: "definicion", activa: false }, despues: { tipo: "instruccion", activa: false } });
    const hist = await cambios(blo.id!);
    expect(hist.map((c) => c.accion)).toEqual(["creada", "eliminada"]);
    expect(hist[1]).toMatchObject({ antes: { tipo: "bloqueo", terminos: [`${marca} uno`, `${marca} dos`] }, despues: null });
  });

  it("valida antes de escribir: bloqueo sin términos no llega a la base", async () => {
    const r = await crearRegla({ tipo: "bloqueo", texto: `Sin términos (${marca}).`, terminos: [] }, null);
    expect(r.error).toMatch(/al menos una palabra/);
    const { count } = await svc.schema("ventas").from("regla_asistente").select("id", { count: "exact", head: true }).like("texto", `%${marca}%`).eq("tipo", "bloqueo");
    expect(count).toBe(0);
  });
});
