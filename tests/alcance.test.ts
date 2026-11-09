/**
 * V1-02, S33: ámbito de datos por persona, aplicado en la base. Con sesiones reales del Supabase local: una persona con
 * ámbito «un canal» ve exactamente lo que el servidor ve filtrando ese canal, nada de otros canales aunque los pida, y
 * deja de estar limitada en su próxima consulta cuando el admin le quita el ámbito. Crea usuarios @bia.test y los borra.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codigoTotp } from "./totp";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!url || !anon || !service)("ámbito de datos en la base", () => {
  let svc: SupabaseClient, sb: SupabaseClient, userId = "", version = 0, canal = "", otro = "";
  const kpi = (c: SupabaseClient, filtros: Record<string, string> = {}) =>
    c.schema("ventas").rpc("kpi_periodo", { p_version: version, p_anio: 2026, p_mes: 9, p_anio_cmp: 2026, p_mes_cmp: 8, p_filtros: filtros }).then((r) => {
      if (r.error) throw r.error;
      return r.data as { venta_neta: number | null; kg: number | null; clientes_con_compra: number };
    });

  beforeAll(async () => {
    svc = createClient(url!, service!, opciones);
    const v = await svc.schema("ventas").rpc("version_vigente");
    version = v.data.version;
    [canal, otro] = (v.data.metadatos.canal as string[]).filter((c) => !["Sin canal", "PENDIENTE"].includes(c));
    const email = `prueba-alcance-${Date.now()}@bia.test`, password = randomBytes(12).toString("hex") + "a1";
    const { data } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    userId = data.user!.id;
    await svc.from("perfil").insert({ user_id: userId, nombre: "alcance", nivel: "plus", alcance: { canal: [canal] } });
    sb = createClient(url!, anon!, opciones);
    await sb.auth.signInWithPassword({ email, password });
    const alta = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "prueba" });
    await sb.auth.mfa.challengeAndVerify({ factorId: alta.data!.id, code: codigoTotp(alta.data!.totp.secret) });
  });

  afterAll(async () => {
    if (userId) await svc.auth.admin.deleteUser(userId);
  });

  it("sin filtros ve solo su canal: lo mismo que el servidor filtrando ese canal", async () => {
    const propio = await kpi(sb);
    const servidor = await kpi(svc, { canal });
    expect(propio).toEqual(servidor);
    expect(Number(propio.venta_neta)).toBeLessThan(Number((await kpi(svc)).venta_neta));
  });

  it("pedir otro canal por filtro no amplía el ámbito", async () => {
    const r = await kpi(sb, { canal: otro });
    expect(Number(r.venta_neta ?? 0)).toBe(0);
    expect(r.clientes_con_compra).toBe(0);
  });

  it("la serie, el detalle por cliente y las listas de la versión también quedan en el ámbito", { timeout: 120_000 }, async () => {
    const serie = (c: SupabaseClient, f = {}) => c.schema("ventas").rpc("serie_mensual", { p_version: version, p_anio: 2026, p_filtros: f }).then((r) => r.data);
    expect(await serie(sb)).toEqual(await serie(svc, { canal }));
    const clientes = (c: SupabaseClient, f = {}) => c.schema("ventas").rpc("clientes_resumen", {
      p_version: version, p_anio: 2026, p_mes: 9, p_anio_cmp: 2026, p_mes_cmp: 8, p_filtros: f }).then((r) => r.data);
    expect(await clientes(sb)).toEqual(await clientes(svc, { canal })); // ~3.5 s en local, igual que sin ámbito
    const meta = (await sb.schema("ventas").rpc("version_vigente")).data;
    expect(meta.metadatos.canal).toEqual([canal]);
    expect(meta.alcance).toEqual({ canal: [canal] });
  });

  it("al quitar el ámbito, su próxima consulta ya ve toda la venta", async () => {
    await svc.from("perfil").update({ alcance: null }).eq("user_id", userId);
    expect(await kpi(sb)).toEqual(await kpi(svc));
  });
});
