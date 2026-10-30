/**
 * G5: control de acceso en la base (0006_acceso.sql) con sesiones reales del Supabase local: anónimo, sin 2FA,
 * sin perfil, perfil inactivo y Estándar con 2FA. Crea usuarios @bia.test y los borra al final.
 * Se salta si no hay service_role (CI sin base).
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codigoTotp } from "./totp";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!url || !anon || !service)("acceso por perfil en la base", () => {
  let svc: SupabaseClient;
  const creados: string[] = [];
  let version = 0;

  async function usuario(nombre: string, perfil: { nivel: "estandar" | "plus"; activo?: boolean } | null, con2fa: boolean) {
    const email = `prueba-${nombre}-${Date.now()}@bia.test`, password = randomBytes(12).toString("hex") + "a1";
    const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    creados.push(data.user.id);
    if (perfil) {
      const r = await svc.from("perfil").insert({ user_id: data.user.id, nombre, nivel: perfil.nivel, activo: perfil.activo ?? true });
      if (r.error) throw r.error;
    }
    const sb = createClient(url!, anon!, opciones);
    const login = await sb.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    if (con2fa) {
      const alta = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "prueba" });
      if (alta.error) throw alta.error;
      const v = await sb.auth.mfa.challengeAndVerify({ factorId: alta.data.id, code: codigoTotp(alta.data.totp.secret) });
      if (v.error) throw v.error;
    }
    return { sb, id: data.user.id };
  }

  const kpi = (sb: SupabaseClient) =>
    sb.schema("ventas").rpc("kpi_periodo", { p_version: version, p_anio: 2026, p_mes: 9, p_anio_cmp: 2026, p_mes_cmp: 8, p_filtros: {} });

  beforeAll(async () => {
    svc = createClient(url!, service!, opciones);
    const { data, error } = await svc.schema("ventas").rpc("version_vigente");
    if (error) throw error;
    version = data.version;
  });

  afterAll(async () => {
    if (creados.length) await svc.schema("ventas").from("consulta_asistente").delete().in("usuario_id", creados);
    for (const id of creados) await svc.auth.admin.deleteUser(id);
  });

  it("anónimo: no puede llamar las funciones de ventas", async () => {
    const { error } = await kpi(createClient(url!, anon!, opciones));
    expect(error).not.toBeNull();
  });

  it("no hay registro abierto: solo se entra por invitación", async () => {
    const { error } = await createClient(url!, anon!, opciones).auth.signUp({ email: `prueba-registro-${Date.now()}@bia.test`, password: "clave-prueba-123" });
    expect(error?.message).toMatch(/signups not allowed/i);
  });

  it("con perfil pero sin 2FA (aal1): acceso denegado", async () => {
    const { sb } = await usuario("aal1", { nivel: "estandar" }, false);
    const { error } = await kpi(sb);
    expect(error?.message).toMatch(/acceso denegado/);
  });

  it("con 2FA pero sin perfil, o con perfil inactivo: acceso denegado", async () => {
    for (const perfil of [null, { nivel: "plus" as const, activo: false }]) {
      const { sb } = await usuario(perfil ? "inactivo" : "sinperfil", perfil, true);
      const { error } = await kpi(sb);
      expect(error?.message).toMatch(/acceso denegado/);
    }
  });

  describe("Estándar con 2FA", () => {
    let sb: SupabaseClient, id: string;
    beforeAll(async () => ({ sb, id } = await usuario("estandar", { nivel: "estandar" }, true)));

    it("lee los agregados de la versión publicada", async () => {
      const v = await sb.schema("ventas").rpc("version_vigente");
      expect(v.error).toBeNull();
      expect(v.data.version).toBe(version);
      const k = await kpi(sb);
      expect(k.error).toBeNull();
      expect(k.data.venta_neta).toBeGreaterThan(0);
      expect(k.data.clientes_con_compra).toBeGreaterThan(0);
      const h = await sb.schema("ventas").rpc("versiones");
      expect(h.error).toBeNull();
      expect(h.data.some((x: { version: number }) => x.version === version)).toBe(true);
    });

    it("no puede publicar, retirar ni conciliar versiones (solo el servidor, tras verificar el rol)", async () => {
      const estado = () => svc.schema("ventas").from("publicacion").select("conciliada_bi, retirada_en").eq("version", version).single().then((r) => r.data);
      const antes = await estado();
      for (const [fn, args] of [["publicar", { p_carga: crypto.randomUUID() }], ["retirar_version", { p_version: version, p_motivo: "intento" }], ["marcar_conciliada", { p_version: version, p_nota: "intento de conciliar" }]] as const) {
        expect((await sb.schema("ventas").rpc(fn, args)).error).not.toBeNull();
      }
      expect(await estado()).toEqual(antes);
    });

    it("no lee filas de hecho (ni clientes) ni las funciones internas", async () => {
      const h = await sb.schema("ventas").from("hecho").select("cliente_nombre").limit(1);
      expect(h.error).not.toBeNull();
      const i = await sb.schema("interno").rpc("kpi_periodo", { p_version: version, p_anio: 2026, p_mes: 9, p_anio_cmp: 2026, p_mes_cmp: 8 });
      expect(i.error).not.toBeNull();
    });

    it("ve solo su perfil y no puede cambiárselo", async () => {
      const p = await sb.from("perfil").select("user_id, nivel");
      expect(p.data).toEqual([{ user_id: id, nivel: "estandar" }]);
      await sb.from("perfil").update({ nivel: "plus", es_admin: true }).eq("user_id", id);
      const despues = await svc.from("perfil").select("nivel, es_admin").eq("user_id", id).single();
      expect(despues.data).toEqual({ nivel: "estandar", es_admin: false });
    });

    it("registra y lee solo sus preguntas en la bitácora", async () => {
      const fila = { version, contexto: "", pregunta: "prueba de acceso", estado: "ok" };
      const propia = await sb.schema("ventas").from("consulta_asistente").insert({ ...fila, usuario_id: id });
      expect(propia.error).toBeNull();
      const ajena = await sb.schema("ventas").from("consulta_asistente").insert({ ...fila, usuario_id: creados[0] });
      expect(ajena.error).not.toBeNull();
      const sinUsuario = await sb.schema("ventas").from("consulta_asistente").insert(fila);
      expect(sinUsuario.error).not.toBeNull();
      const mias = await sb.schema("ventas").from("consulta_asistente").select("usuario_id");
      expect(mias.data?.length).toBe(1);
      expect(mias.data?.every((f) => f.usuario_id === id)).toBe(true);
    });
  });
});
