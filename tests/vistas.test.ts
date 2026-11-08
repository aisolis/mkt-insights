/**
 * G9: vistas guardadas del dashboard. La limpieza de la query string (vistas-consulta.ts) y el acceso por RLS de
 * 0018_vistas.sql con sesiones reales del Supabase local: cada quien lee las suyas y las compartidas, solo el dueño
 * las cambia o borra, y sin 2FA no hay nada. Crea usuarios @bia.test desechables y los borra al final (sus vistas
 * caen por cascada). La parte de base se salta si no hay service_role (CI sin base).
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consultaDeVista, resumenVista, tienePeriodo, vistaActiva } from "@/lib/dashboard/vistas-consulta";
import type { PeriodoMeta } from "@/lib/semantic/contracts";
import { codigoTotp } from "./totp";

// --- Limpieza de la consulta -------------------------------------------------------------------------------------
const periodos: PeriodoMeta[] = [
  { anio: 2026, mes: 8, dias: 26, ultimo_dia: "2026-08-31", cerrado: true },
  { anio: 2026, mes: 9, dias: 26, ultimo_dia: "2026-09-30", cerrado: true },
  { anio: 2026, mes: 10, dias: 12, ultimo_dia: "2026-10-14", cerrado: false },
];

describe("consultaDeVista", () => {
  it("deja solo parámetros conocidos, en orden fijo", () => {
    expect(consultaDeVista("marca=ORO&utm_source=x&periodo=2026-08&canal=Mayoreo&redirect=//malo&comparar=anio", periodos, true))
      .toBe("periodo=2026-08&comparar=anio&canal=Mayoreo&marca=ORO");
  });

  it("acepta la query string con '?' y quita valores vacíos o con solo espacios", () => {
    expect(consultaDeVista("?periodo=2026-09&canal=%20%20&ruta=&producto=1001", periodos, true)).toBe("periodo=2026-09&producto=1001");
  });

  it("'siempre el último mes': se guarda sin periodo", () => {
    expect(consultaDeVista("periodo=2026-08&canal=Detalle", periodos, false)).toBe("canal=Detalle");
    expect(tienePeriodo(consultaDeVista("periodo=2026-08", periodos, false))).toBe(false);
    expect(consultaDeVista("periodo=2026-08", periodos, false)).toBe("");
  });

  it("periodo fijo que no existe en la versión: queda el de por defecto (último mes cerrado)", () => {
    expect(consultaDeVista("periodo=2030-01", periodos, true)).toBe("periodo=2026-09");
    expect(consultaDeVista("periodo=<script>", periodos, true)).toBe("periodo=2026-09");
  });

  it("comparar solo admite 'anio'; lo demás es el periodo anterior (no se escribe)", () => {
    expect(consultaDeVista("comparar=cualquiera&marca=ORO", periodos, false)).toBe("marca=ORO");
  });

  it("sin periodos publicados no fija periodo", () => {
    expect(consultaDeVista("periodo=2026-09&canal=Detalle", [], true)).toBe("canal=Detalle");
  });

  it("caracteres especiales en filtros viajan codificados y vuelven igual", () => {
    const q = consultaDeVista("ruta=127 - EL PARAÍSO&marca=A%26B", periodos, false);
    expect(new URLSearchParams(q).get("ruta")).toBe("127 - EL PARAÍSO");
    expect(new URLSearchParams(q).get("marca")).toBe("A&B");
  });
});

describe("resumenVista y vistaActiva", () => {
  it("describe periodo y filtros en palabras", () => {
    expect(resumenVista("canal=Mayoreo&marca=ORO")).toBe("Último mes · Mayoreo · ORO");
    expect(resumenVista("periodo=2026-08&comparar=anio&producto=1001")).toBe("Ago 2026 · vs. año anterior · Producto 1001");
  });

  it("una vista sin periodo coincide con la pantalla en el mes por defecto, no en otro", () => {
    expect(vistaActiva("canal=Mayoreo", "periodo=2026-09&canal=Mayoreo", periodos)).toBe(true);
    expect(vistaActiva("canal=Mayoreo", "periodo=2026-08&canal=Mayoreo", periodos)).toBe(false);
    expect(vistaActiva("periodo=2026-08&canal=Mayoreo", "canal=Mayoreo&periodo=2026-08", periodos)).toBe(true);
    expect(vistaActiva("canal=Mayoreo", "periodo=2026-09", periodos)).toBe(false);
  });
});

// --- RLS ---------------------------------------------------------------------------------------------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!url || !anon || !service)("vistas guardadas: acceso en la base", () => {
  let svc: SupabaseClient;
  const creados: string[] = [];
  let a: { sb: SupabaseClient; id: string }, b: { sb: SupabaseClient; id: string };
  let privada = "", compartida = "";
  const marca = Date.now();

  async function usuario(nombre: string, con2fa = true) {
    const email = `prueba-vistas-${nombre}-${marca}@bia.test`, password = randomBytes(12).toString("hex") + "a1";
    const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    creados.push(data.user.id);
    const p = await svc.from("perfil").insert({ user_id: data.user.id, nombre: `Prueba ${nombre}`, nivel: "estandar" });
    if (p.error) throw p.error;
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
  const vistas = (sb: SupabaseClient) => sb.schema("ventas").from("vista_guardada");
  const enBase = (id: string) => vistas(svc).select("usuario_id, nombre, consulta, compartida").eq("id", id).single();

  beforeAll(async () => {
    svc = createClient(url!, service!, opciones);
    [a, b] = await Promise.all([usuario("a"), usuario("b")]);
    const r = await vistas(a.sb).insert([
      { usuario_id: a.id, nombre: "Privada de A", consulta: "canal=Mayoreo", compartida: false },
      { usuario_id: a.id, nombre: "Compartida de A", consulta: "periodo=2026-09&marca=ORO", compartida: true },
    ]).select("id, nombre, autor:autor_vista");
    if (r.error) throw r.error;
    // El campo calculado también viene al crear (así lo usa guardarVista).
    expect(r.data.map((v) => v.autor)).toEqual(["Prueba a", "Prueba a"]);
    privada = r.data.find((v) => v.nombre === "Privada de A")!.id;
    compartida = r.data.find((v) => v.nombre === "Compartida de A")!.id;
  });

  afterAll(async () => {
    if (!svc) return;
    if (creados.length) await vistas(svc).delete().in("usuario_id", creados);
    for (const id of creados) await svc.auth.admin.deleteUser(id);
  });

  it("el dueño lee sus dos vistas, con su nombre como autor", async () => {
    const r = await vistas(a.sb).select("id, nombre, autor:autor_vista").in("id", [privada, compartida]).order("nombre");
    expect(r.error).toBeNull();
    expect(r.data).toEqual([
      { id: compartida, nombre: "Compartida de A", autor: "Prueba a" },
      { id: privada, nombre: "Privada de A", autor: "Prueba a" },
    ]);
  });

  it("otro usuario no ve la privada; ve la compartida con el nombre de quien la creó", async () => {
    const r = await vistas(b.sb).select("id, autor:autor_vista").in("id", [privada, compartida]);
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ id: compartida, autor: "Prueba a" }]);
  });

  it("autor_vista no revela nombres de vistas privadas ajenas aunque se llame directo", async () => {
    const fila = { id: privada, usuario_id: a.id, nombre: "x", consulta: "", compartida: false, creada_en: new Date().toISOString(), actualizada_en: new Date().toISOString() };
    const r = await b.sb.schema("ventas").rpc("autor_vista", { v: fila });
    // Según la versión de PostgREST la llamada falla o devuelve null; en ningún caso el nombre.
    expect(r.data ?? null).toBeNull();
    const inventada = await b.sb.schema("ventas").rpc("autor_vista", { v: { ...fila, id: compartida, usuario_id: a.id, compartida: true } });
    // La compartida sí existe y es de A: el nombre ya es visible en la lista, no se filtra nada nuevo.
    expect([null, "Prueba a"]).toContain(inventada.data ?? null);
  });

  it("otro usuario no puede renombrar, dejar de compartir ni borrar la vista compartida", async () => {
    const r = await vistas(b.sb).update({ nombre: "secuestrada", compartida: false }).eq("id", compartida).select("id");
    expect(r.data ?? []).toEqual([]);
    await vistas(b.sb).delete().eq("id", compartida);
    await vistas(b.sb).delete().eq("id", privada);
    expect((await enBase(compartida)).data).toEqual({ usuario_id: a.id, nombre: "Compartida de A", consulta: "periodo=2026-09&marca=ORO", compartida: true });
    expect((await enBase(privada)).data?.nombre).toBe("Privada de A");
  });

  it("nadie crea vistas a nombre ajeno ni se queda con una (cambiar el dueño no está permitido)", async () => {
    expect((await vistas(b.sb).insert({ usuario_id: a.id, nombre: "Falsa", consulta: "" })).error).not.toBeNull();
    const propia = await vistas(b.sb).insert({ usuario_id: b.id, nombre: "De B", consulta: "" }).select("id").single();
    expect(propia.error).toBeNull();
    expect((await vistas(b.sb).update({ usuario_id: a.id }).eq("id", propia.data!.id)).error).not.toBeNull();
    expect((await enBase(propia.data!.id)).data?.usuario_id).toBe(b.id);
    // Las fechas las pone la base.
    expect((await vistas(b.sb).insert({ usuario_id: b.id, nombre: "Con fecha", creada_en: "2000-01-01T00:00:00Z" })).error).not.toBeNull();
  });

  it("el dueño renombra, comparte y borra; actualizada_en se mueve sola", async () => {
    const antes = await vistas(a.sb).select("actualizada_en").eq("id", privada).single();
    const r = await vistas(a.sb).update({ nombre: "Mayoreo", compartida: true }).eq("id", privada).select("nombre, compartida, actualizada_en").single();
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ nombre: "Mayoreo", compartida: true });
    expect(new Date(r.data!.actualizada_en).getTime()).toBeGreaterThan(new Date(antes.data!.actualizada_en).getTime());
    // Ahora B la ve.
    expect((await vistas(b.sb).select("id").eq("id", privada)).data).toEqual([{ id: privada }]);

    const temporal = await vistas(a.sb).insert({ usuario_id: a.id, nombre: "Temporal", consulta: "" }).select("id").single();
    const borrada = await vistas(a.sb).delete().eq("id", temporal.data!.id).select("id");
    expect(borrada.data).toEqual([{ id: temporal.data!.id }]);
    expect((await vistas(svc).select("id").eq("id", temporal.data!.id)).data).toEqual([]);
  });

  it("nombre: 1 a 60 caracteres, sin espacios a los lados y sin repetir (sin distinguir mayúsculas)", async () => {
    const nueva = (nombre: string) => vistas(a.sb).insert({ usuario_id: a.id, nombre, consulta: "" });
    expect((await nueva("")).error).not.toBeNull();
    expect((await nueva(" con espacios ")).error).not.toBeNull();
    expect((await nueva("x".repeat(61))).error).not.toBeNull();
    expect((await nueva("x".repeat(60))).error).toBeNull();
    const repetida = await nueva("COMPARTIDA DE A");
    expect(repetida.error?.code).toBe("23505");
    // El mismo nombre en otro usuario sí se puede.
    expect((await vistas(b.sb).insert({ usuario_id: b.id, nombre: "Compartida de A", consulta: "" })).error).toBeNull();
    // La consulta se guarda sin '?' y acotada.
    expect((await vistas(a.sb).insert({ usuario_id: a.id, nombre: "Con signo", consulta: "?canal=Detalle" })).error).not.toBeNull();
    expect((await vistas(a.sb).insert({ usuario_id: a.id, nombre: "Larga", consulta: "x".repeat(2001) })).error).not.toBeNull();
  });

  it("sin 2FA (aal1) o anónimo: no lee ni crea vistas, ni las compartidas", async () => {
    const sin2fa = await usuario("aal1", false);
    expect((await vistas(sin2fa.sb).select("id").eq("id", compartida)).data ?? []).toEqual([]);
    expect((await vistas(sin2fa.sb).insert({ usuario_id: sin2fa.id, nombre: "Sin 2FA", consulta: "" })).error).not.toBeNull();
    const anonimo = createClient(url!, anon!, opciones);
    const lectura = await vistas(anonimo).select("id").eq("id", compartida);
    expect(lectura.data ?? []).toEqual([]);
    expect((await vistas(anonimo).insert({ usuario_id: a.id, nombre: "Anónima", consulta: "" })).error).not.toBeNull();
  });
});
