/**
 * G9: clientes por estado (0015_clientes.sql) sobre la versión publicada real del Supabase local.
 * Lógica: los estados se reparten sin traslape, cuadran con kpi_periodo y con un cálculo independiente sobre el
 * hecho para una muestra de clientes. Acceso: Estándar con 2FA recibe "acceso denegado", Plus con 2FA lee lo
 * mismo que service_role. Crea usuarios @bia.test y los borra al final. Se salta si no hay service_role.
 * No imprime códigos ni nombres de cliente.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearConsultasClientes, type ResumenClientes } from "@/lib/semantic/clientes";
import { crearConsultas, type Rpc } from "@/lib/semantic/consultas";
import type { Filtros, Periodo } from "@/lib/semantic/contracts";
import { codigoTotp } from "./totp";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const LENTO = 120_000; // cada llamada recorre la historia de la versión (≈ 1 M de líneas, 3–5 s)

const rpcDe = (sb: SupabaseClient): Rpc => async (fn, args, schema) => {
  const { data, error } = await sb.schema("ventas").rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return schema.parse(data);
};
const clave = (p: Periodo) => p.anio * 100 + p.mes;
const anterior = (p: Periodo): Periodo => (p.mes === 1 ? { anio: p.anio - 1, mes: 12 } : { anio: p.anio, mes: p.mes - 1 });

describe.skipIf(!url || !anon || !service)("clientes por estado (solo Plus)", () => {
  let svc: SupabaseClient;
  let version = 0;
  let periodo: Periodo, cmp: Periodo;
  let canal = "";
  const creados: string[] = [];

  beforeAll(async () => {
    svc = createClient(url!, service!, opciones);
    const v = await crearConsultas(rpcDe(svc)).versionVigente();
    if (!v) throw new Error("no hay versión publicada");
    version = v.version;
    const cerrados = v.metadatos.periodos.filter((p) => p.cerrado);
    const ultimo = cerrados.at(-1) ?? v.metadatos.periodos.at(-1)!;
    periodo = { anio: ultimo.anio, mes: ultimo.mes };
    cmp = anterior(periodo);
    canal = v.metadatos.canal[0];
  });

  afterAll(async () => {
    for (const id of creados) await svc.auth.admin.deleteUser(id);
  });

  /** Invariantes del reparto contra kpi_periodo con los mismos periodos y filtros. */
  async function verificarReparto(p: Periodo, c: Periodo, filtros: Filtros) {
    const req = { version, periodo: p, comparar: c, filtros };
    const [r, kpi] = await Promise.all([crearConsultasClientes(rpcDe(svc)).clientesResumen(req), crearConsultas(rpcDe(svc)).kpiPeriodo(req)]);
    const e = r.estados;
    expect(e.activos.clientes).toBe(kpi.clientes_con_compra);
    expect(e.nuevos.clientes + e.recuperados.clientes + e.continuan.clientes).toBe(e.activos.clientes);
    expect(e.continuan.clientes + e.perdidos.clientes).toBe(kpi.clientes_con_compra_cmp);
    expect(e.en_riesgo.clientes).toBeLessThanOrEqual(e.continuan.clientes);
    expect(e.activos.venta).toBeCloseTo(e.nuevos.venta + e.recuperados.venta + e.continuan.venta, 2);
    // Activos: venta de quienes compraron (> 0). kpi suma también a quienes solo devolvieron, así que no es mayor.
    expect(e.activos.venta).toBeGreaterThanOrEqual(kpi.venta_neta - 0.005);
    expect(e.nuevos.venta_cmp).toBeLessThanOrEqual(0);
    expect(e.perdidos.venta).toBeLessThanOrEqual(0);
    expect(e.en_riesgo.venta).toBeLessThan(e.en_riesgo.venta_cmp * (1 - r.umbral_riesgo) + 0.005);
    // Por ruta principal: cada cliente cuenta una vez, la suma da el total.
    const suma = (k: "activos" | "nuevos" | "recuperados" | "continuan" | "perdidos" | "en_riesgo") => r.por_ruta.reduce((s, f) => s + f[k], 0);
    for (const k of ["activos", "nuevos", "recuperados", "continuan", "perdidos", "en_riesgo"] as const) expect(suma(k), k).toBe(e[k].clientes);
    expect(r.por_ruta.reduce((s, f) => s + f.venta_activos, 0)).toBeCloseTo(e.activos.venta, 2);
    expect(r.por_ruta.reduce((s, f) => s + f.venta_perdidos_cmp, 0)).toBeCloseTo(e.perdidos.venta_cmp, 2);
    return r;
  }

  describe("lógica sobre la versión publicada", () => {
    let resumen: ResumenClientes;

    it("mes contra mes anterior: activos = nuevos + recuperados + siguen; cuadra con kpi_periodo", async () => {
      resumen = await verificarReparto(periodo, cmp, {});
      expect(resumen.estados.activos.clientes).toBeGreaterThan(0);
      expect(resumen.estados.perdidos.clientes).toBeGreaterThan(0);
      expect(resumen.umbral_riesgo).toBe(0.5);
    }, LENTO);

    it("contra el año anterior y con un filtro de canal también cuadra", async () => {
      await Promise.all([
        verificarReparto(periodo, { anio: periodo.anio - 1, mes: periodo.mes }, {}),
        verificarReparto(periodo, cmp, { canal }),
      ]);
    }, LENTO);

    it("las listas cuadran con los conteos, se paginan y vienen ordenadas", async () => {
      const q = crearConsultasClientes(rpcDe(svc));
      const base = { version, periodo, comparar: cmp, filtros: {} };
      const [perdidos, perdidos2, riesgo, nuevos] = await Promise.all([
        q.clientesLista({ ...base, estado: "perdidos", limite: 20 }),
        q.clientesLista({ ...base, estado: "perdidos", limite: 20, desplazamiento: 20 }),
        q.clientesLista({ ...base, estado: "en_riesgo", limite: 20 }),
        q.clientesLista({ ...base, estado: "nuevos", limite: 20 }),
      ]);
      expect(perdidos.total).toBe(resumen.estados.perdidos.clientes);
      expect(riesgo.total).toBe(resumen.estados.en_riesgo.clientes);
      expect(nuevos.total).toBe(resumen.estados.nuevos.clientes);
      expect(perdidos.filas).toHaveLength(Math.min(20, perdidos.total));
      const ids = (l: typeof perdidos) => l.filas.map((f) => `${f.empresa}|${f.cliente_codigo}`);
      expect(ids(perdidos).filter((x) => ids(perdidos2).includes(x))).toEqual([]);
      // Perdidos: de mayor a menor compra en el periodo comparado; la página 2 sigue donde terminó la 1.
      const cmpVentas = [...perdidos.filas, ...perdidos2.filas].map((f) => f.venta_cmp);
      expect(cmpVentas).toEqual(cmpVentas.toSorted((a, b) => b - a));
      for (const f of perdidos.filas) {
        expect(f.estado).toBe("perdido");
        expect(f.venta).toBeLessThanOrEqual(0);
        expect(f.ultima_compra && f.ultima_compra < `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}-01`).toBe(true);
      }
      for (const f of riesgo.filas) {
        expect(f.estado).toBe("continua");
        expect(f.en_riesgo).toBe(true);
        expect(f.venta).toBeLessThan(f.venta_cmp * 0.5);
        expect(f.variacion).toBeCloseTo(f.venta - f.venta_cmp, 2);
      }
      for (const f of nuevos.filas) expect(f.cliente_nombre).toBeTruthy();
    }, LENTO);

    it("nuevos y recuperados coinciden con un cálculo independiente sobre las líneas del cliente", async () => {
      const q = crearConsultasClientes(rpcDe(svc));
      const base = { version, periodo, comparar: cmp, filtros: {} };
      const [nuevos, recuperados] = await Promise.all([
        q.clientesLista({ ...base, estado: "nuevos", limite: 3 }),
        q.clientesLista({ ...base, estado: "recuperados", limite: 3 }),
      ]);
      const vm = await svc.schema("ventas").from("version_mes").select("anio, mes, carga_id").eq("version", version);
      expect(vm.error).toBeNull();
      const cargaDelMes = new Map(vm.data!.map((m) => [m.anio * 100 + m.mes, m.carga_id as string]));

      /** Venta neta por mes del cliente en la versión, hasta el periodo (sin pasar por las funciones de 0015). */
      async function meses(empresa: string, codigo: string) {
        const lineas: { carga_id: string; anio: number; mes: number; venta_neta: string | number }[] = [];
        for (let desde = 0; ; desde += 1000) { // la API devuelve hasta 1000 filas por llamada (max_rows)
          const { data, error } = await svc.schema("ventas").from("hecho").select("carga_id, anio, mes, venta_neta")
            .eq("empresa", empresa).eq("cliente_codigo", codigo).order("id").range(desde, desde + 999);
          expect(error).toBeNull();
          lineas.push(...data!);
          if (data!.length < 1000) break;
        }
        const porMes = new Map<number, number>();
        for (const h of lineas) {
          const k = h.anio * 100 + h.mes;
          if (cargaDelMes.get(k) !== h.carga_id || k > clave(periodo)) continue;
          porMes.set(k, (porMes.get(k) ?? 0) + Number(h.venta_neta));
        }
        return porMes;
      }
      expect(nuevos.filas.length + recuperados.filas.length).toBeGreaterThan(0);
      for (const f of nuevos.filas) {
        const m = await meses(f.empresa, f.cliente_codigo);
        expect(m.get(clave(periodo))! > 0).toBe(true);
        expect([...m].filter(([k, v]) => k < clave(periodo) && v > 0.005)).toEqual([]);
      }
      for (const f of recuperados.filas) {
        const m = await meses(f.empresa, f.cliente_codigo);
        expect(m.get(clave(periodo))! > 0).toBe(true);
        expect((m.get(clave(cmp)) ?? 0) <= 0.005).toBe(true);
        expect([...m].some(([k, v]) => k < clave(cmp) && v > 0.005)).toBe(true);
      }
    }, LENTO);

    it("rechaza un estado que no existe", async () => {
      const { error } = await svc.schema("ventas").rpc("clientes_lista", {
        p_version: version, p_anio: periodo.anio, p_mes: periodo.mes, p_anio_cmp: cmp.anio, p_mes_cmp: cmp.mes, p_filtros: {}, p_estado: "todos",
      });
      expect(error?.message).toMatch(/estado no permitido/);
    });
  });

  describe("acceso", () => {
    async function usuario(nombre: string, nivel: "estandar" | "plus") {
      const email = `prueba-clientes-${nombre}-${Date.now()}@bia.test`, password = randomBytes(12).toString("hex") + "a1";
      const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      creados.push(data.user.id);
      const r = await svc.from("perfil").insert({ user_id: data.user.id, nombre, nivel });
      if (r.error) throw r.error;
      const sb = createClient(url!, anon!, opciones);
      const login = await sb.auth.signInWithPassword({ email, password });
      if (login.error) throw login.error;
      const alta = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "prueba" });
      if (alta.error) throw alta.error;
      const v = await sb.auth.mfa.challengeAndVerify({ factorId: alta.data.id, code: codigoTotp(alta.data.totp.secret) });
      if (v.error) throw v.error;
      return sb;
    }
    const args = () => ({ p_version: version, p_anio: periodo.anio, p_mes: periodo.mes, p_anio_cmp: cmp.anio, p_mes_cmp: cmp.mes, p_filtros: {} });

    it("anónimo: no puede llamar las funciones de clientes", async () => {
      const sb = createClient(url!, anon!, opciones);
      expect((await sb.schema("ventas").rpc("clientes_resumen", args())).error).not.toBeNull();
      expect((await sb.schema("ventas").rpc("clientes_lista", { ...args(), p_estado: "perdidos" })).error).not.toBeNull();
    });

    it("Estándar con 2FA: acceso denegado, aunque sí lee los agregados del dashboard", async () => {
      const sb = await usuario("estandar", "estandar");
      const r = await sb.schema("ventas").rpc("clientes_resumen", args());
      expect(r.error?.message).toMatch(/requiere perfil Plus/);
      const l = await sb.schema("ventas").rpc("clientes_lista", { ...args(), p_estado: "perdidos" });
      expect(l.error?.message).toMatch(/requiere perfil Plus/);
      expect((await sb.schema("ventas").rpc("kpi_periodo", args())).error).toBeNull();
    }, LENTO);

    it("Plus con 2FA: lee el resumen y la lista, igual que el servidor; no llama las funciones internas", async () => {
      const sb = await usuario("plus", "plus");
      const base = { version, periodo, comparar: cmp, filtros: {} };
      const [dePlus, deSvc, lista] = await Promise.all([
        crearConsultasClientes(rpcDe(sb)).clientesResumen(base),
        crearConsultasClientes(rpcDe(svc)).clientesResumen(base),
        crearConsultasClientes(rpcDe(sb)).clientesLista({ ...base, estado: "perdidos", limite: 5 }),
      ]);
      expect(dePlus.estados).toEqual(deSvc.estados);
      expect(lista.filas.length).toBeGreaterThan(0);
      expect((await sb.schema("interno").rpc("clientes_resumen", args())).error).not.toBeNull();
    }, LENTO);
  });
});
