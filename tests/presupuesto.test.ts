/**
 * Presupuesto de IA por persona: cuándo una pregunta deja de usar IA y, contra la base (0032), cómo se calcula el
 * límite y el gasto de cada quien, y el ciclo de una solicitud de ampliación.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Decision } from "@/lib/asistente/modelo";
import { conPresupuesto, estadoPresupuesto, FilaPresupuesto, leerMonto, SIN_LIMITE, textoResolucion } from "@/lib/asistente/presupuesto";

describe("estado del presupuesto", () => {
  it("agotado cuando lo gastado alcanza el límite; sin límite nunca se agota", () => {
    expect(estadoPresupuesto({ limite_usd: 5, gasto_usd: 1.25, pendiente: false })).toEqual({ limiteUsd: 5, gastoUsd: 1.25, restanteUsd: 3.75, agotado: false, pendiente: false });
    expect(estadoPresupuesto({ limite_usd: 5, gasto_usd: 5, pendiente: true })).toMatchObject({ restanteUsd: 0, agotado: true, pendiente: true });
    expect(estadoPresupuesto({ limite_usd: 5, gasto_usd: 5.4, pendiente: false })).toMatchObject({ restanteUsd: 0, agotado: true });
    expect(estadoPresupuesto({ limite_usd: null, gasto_usd: 900, pendiente: false })).toMatchObject({ limiteUsd: null, restanteUsd: null, agotado: false });
  });

  it("lee montos con coma, punto o signo; vacío es null y lo demás no es un monto", () => {
    expect(leerMonto(" 5 ")).toBe(5);
    expect(leerMonto("US$ 2,50")).toBe(2.5);
    expect(leerMonto("$0.129")).toBe(0.13);
    expect(leerMonto("")).toBeNull();
    for (const malo of ["0", "-3", "cinco", "1.2.3"]) expect(leerMonto(malo), malo).toBeNaN();
  });
});

describe("aviso de cómo se resolvió una solicitud", () => {
  const r = { id: 7, resueltaEn: "2026-11-20T15:00:00Z" };
  it("dice el monto aprobado o que no se aprobó, y agrega la nota solo si la hay", () => {
    expect(textoResolucion({ ...r, estado: "aprobada", montoUsd: 5, nota: null })).toMatch(/^Te aprobaron US\$\s?5[.,]00 más de presupuesto de IA para este mes\.$/);
    expect(textoResolucion({ ...r, estado: "aprobada", montoUsd: 5, nota: "Para el cierre." })).toMatch(/para este mes\. Nota de quien la revisó: «Para el cierre\.»$/);
    expect(textoResolucion({ ...r, estado: "rechazada", montoUsd: null, nota: null })).toBe("No se aprobó tu solicitud de ampliación de presupuesto de IA.");
    expect(textoResolucion({ ...r, estado: "rechazada", montoUsd: null, nota: "Espera al próximo mes." }))
      .toBe("No se aprobó tu solicitud de ampliación de presupuesto de IA. Nota de quien la revisó: «Espera al próximo mes.»");
  });
});

describe("decisión de modelo con presupuesto", () => {
  const conModelo: Decision = { modelo: { apiKey: "k", modelo: "m" }, motivo: null, aviso: null };
  const agotado = estadoPresupuesto({ limite_usd: 2, gasto_usd: 2.1, pendiente: false });

  it("con presupuesto disponible o sin límite, la decisión global no cambia", () => {
    expect(conPresupuesto(conModelo, estadoPresupuesto({ limite_usd: 2, gasto_usd: 1.99, pendiente: false }))).toBe(conModelo);
    expect(conPresupuesto(conModelo, SIN_LIMITE)).toBe(conModelo);
  });

  it("agotado: responde el automático, con su motivo y un aviso que dice el monto", () => {
    const d = conPresupuesto(conModelo, agotado);
    expect(d.modelo).toBeNull();
    expect(d.motivo).toBe("presupuesto_usuario");
    expect(d.aviso).toContain("Se acabó tu presupuesto de IA de este mes");
    expect(d.aviso).toMatch(/2[.,]00/);
  });

  it("si la app ya estaba sin IA (tope global, modelo no permitido), manda ese motivo", () => {
    const tope: Decision = { modelo: null, motivo: "tope_gasto", aviso: "tope" };
    expect(conPresupuesto(tope, agotado)).toBe(tope);
    const apagada: Decision = { modelo: null, motivo: null, aviso: null };
    expect(conPresupuesto(apagada, agotado)).toBe(apagada);
  });
});

// Contra la base (0032_presupuesto_ia_usuario.sql). Se salta si no hay service_role (CI sin base). -------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!url || !anon || !service)("presupuesto de IA en la base", () => {
  let svc: SupabaseClient;
  let generalAntes: number | string | null = null;
  const usuarios: string[] = [];
  const ventas = () => svc.schema("ventas");

  async function persona(nombre: string) {
    const email = `prueba-presupuesto-${Date.now()}-${randomBytes(3).toString("hex")}@bia.test`, password = randomBytes(12).toString("hex") + "a1";
    const { data } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    usuarios.push(data.user!.id);
    await svc.from("perfil").insert({ user_id: data.user!.id, nombre, nivel: "estandar" });
    return { id: data.user!.id, email, password };
  }
  async function de(usuario: string) {
    const r = await ventas().rpc("presupuestos_ia", { p_usuario: usuario });
    if (r.error) throw r.error;
    return FilaPresupuesto.parse(r.data[0]);
  }
  const gastar = async (usuario: string, costo: number, extra: Record<string, unknown> = {}) => {
    const r = await ventas().from("consulta_asistente").insert({ usuario_id: usuario, version: 1, contexto: "", pregunta: "prueba de presupuesto", estado: "ok", modo: "modelo", costo_usd: costo, ...extra });
    if (r.error) throw r.error;
  };

  beforeAll(async () => {
    svc = createClient(url!, service!, opciones);
    generalAntes = (await ventas().from("config_asistente").select("presupuesto_usuario_usd").single()).data!.presupuesto_usuario_usd;
    await ventas().rpc("guardar_presupuesto_general", { p_monto: 2 });
  });
  afterAll(async () => {
    await ventas().rpc("guardar_presupuesto_general", { p_monto: generalAntes });
    for (const id of usuarios) await svc.auth.admin.deleteUser(id); // bitácora, presupuesto y solicitudes se van por cascada
  });

  it("el límite sale del general, de uno propio o queda sin límite; el gasto suma preguntas y fotos del mes", async () => {
    const ana = await persona("Ana presupuesto");
    expect(await de(ana.id)).toMatchObject({ origen: "general", base_usd: 2, limite_usd: 2, gasto_usd: 0, preguntas: 0, pendiente: false });

    await gastar(ana.id, 0.4);
    await gastar(ana.id, 0.35);
    await gastar(ana.id, 9, { creado_en: "2020-01-15T12:00:00Z" }); // de otro mes: no cuenta
    await ventas().from("consulta_asistente").insert({ usuario_id: ana.id, version: 1, contexto: "", pregunta: "sin costo", estado: "ok", modo: "determinista" });
    const conv = await ventas().from("conversacion").insert({ usuario_id: ana.id, titulo: "Adjunto: foto", contexto: "" }).select("id").single();
    await ventas().from("adjunto").insert({ conversacion_id: conv.data!.id, usuario_id: ana.id, nombre: "foto.png", tipo: "imagen", ruta_archivo: `pruebas/${crypto.randomUUID()}.png`, costo_usd: 0.25 });
    expect(await de(ana.id)).toMatchObject({ gasto_usd: 1, preguntas: 2, limite_usd: 2 });

    await ventas().rpc("guardar_presupuesto_ia", { p_usuario: ana.id, p_monto: 0.5, p_sin_limite: false });
    expect(await de(ana.id)).toMatchObject({ origen: "propio", base_usd: 0.5, limite_usd: 0.5, gasto_usd: 1 });
    await ventas().rpc("guardar_presupuesto_ia", { p_usuario: ana.id, p_monto: null, p_sin_limite: true });
    expect(await de(ana.id)).toMatchObject({ origen: "sin_limite", base_usd: null, limite_usd: null });
    await ventas().rpc("guardar_presupuesto_ia", { p_usuario: ana.id, p_monto: null, p_sin_limite: false });
    expect(await de(ana.id)).toMatchObject({ origen: "general", limite_usd: 2 });
    // El gasto de una persona no se mezcla con el de otra.
    expect(await de((await persona("Luis presupuesto")).id)).toMatchObject({ gasto_usd: 0, preguntas: 0 });
  });

  it("una solicitud a la vez; aprobada suma al límite de este mes, rechazada no; no se resuelve dos veces", async () => {
    const ana = await persona("Ana ampliación"), admin = await persona("Admin ampliación");
    await gastar(ana.id, 2.2);
    const s1 = await ventas().rpc("solicitar_ampliacion_ia", { p_usuario: ana.id, p_motivo: "  cierre de mes  " });
    expect(s1.error).toBeNull();
    expect(await de(ana.id)).toMatchObject({ pendiente: true, limite_usd: 2 });
    const repetida = await ventas().rpc("solicitar_ampliacion_ia", { p_usuario: ana.id, p_motivo: null });
    expect(repetida.error).toMatchObject({ code: "P0001", message: "Ya tienes una solicitud pendiente este mes." });

    expect((await ventas().rpc("resolver_ampliacion_ia", { p_id: s1.data, p_aprobar: true, p_monto: null, p_respuesta: null, p_admin: admin.id })).error?.code).toBe("22023");
    expect((await ventas().rpc("resolver_ampliacion_ia", { p_id: s1.data, p_aprobar: true, p_monto: 1.5, p_respuesta: "Para el cierre.", p_admin: admin.id })).error).toBeNull();
    expect(await de(ana.id)).toMatchObject({ pendiente: false, base_usd: 2, ampliaciones_usd: 1.5, limite_usd: 3.5, gasto_usd: 2.2 });
    const fila = await ventas().from("ampliacion_ia").select("estado, motivo, monto_usd, respuesta, resuelta_por").eq("id", s1.data).single();
    expect(fila.data).toMatchObject({ estado: "aprobada", motivo: "cierre de mes", respuesta: "Para el cierre.", resuelta_por: admin.id });
    expect((await ventas().rpc("resolver_ampliacion_ia", { p_id: s1.data, p_aprobar: false, p_monto: null, p_respuesta: null, p_admin: admin.id })).error?.code).toBe("P0001");

    // Otra solicitud, rechazada: el límite no cambia y puede volver a pedir.
    const s2 = await ventas().rpc("solicitar_ampliacion_ia", { p_usuario: ana.id });
    await ventas().rpc("resolver_ampliacion_ia", { p_id: s2.data, p_aprobar: false, p_monto: null, p_respuesta: null, p_admin: admin.id });
    expect(await de(ana.id)).toMatchObject({ pendiente: false, limite_usd: 3.5 });
    // Una ampliación aprobada de otro mes no cuenta para este.
    await ventas().from("ampliacion_ia").insert({ usuario_id: ana.id, mes: "2020-01-01", estado: "aprobada", monto_usd: 50 });
    expect(await de(ana.id)).toMatchObject({ ampliaciones_usd: 1.5, limite_usd: 3.5 });
  });

  it("la bitácora acepta el motivo «presupuesto_usuario»", async () => {
    const ana = await persona("Ana motivo");
    const r = await ventas().from("consulta_asistente").insert({ usuario_id: ana.id, version: 1, contexto: "", pregunta: "sin presupuesto", estado: "ok", modo: "determinista", motivo_automatico: "presupuesto_usuario" });
    expect(r.error).toBeNull();
  });

  it("una persona con sesión no lee ni cambia presupuestos ni solicitudes directamente", async () => {
    const ana = await persona("Ana sesión");
    const sb = createClient(url!, anon!, opciones);
    await sb.auth.signInWithPassword({ email: ana.email, password: ana.password });
    const v = sb.schema("ventas");
    expect((await v.from("presupuesto_ia").select("usuario_id").limit(1)).error).not.toBeNull();
    expect((await v.from("ampliacion_ia").select("id").limit(1)).error).not.toBeNull();
    expect((await v.rpc("presupuestos_ia", { p_usuario: ana.id })).error).not.toBeNull();
    expect((await v.rpc("guardar_presupuesto_ia", { p_usuario: ana.id, p_monto: 999, p_sin_limite: false })).error).not.toBeNull();
    expect((await v.rpc("solicitar_ampliacion_ia", { p_usuario: ana.id })).error).not.toBeNull();
    expect((await v.rpc("resolver_ampliacion_ia", { p_id: 1, p_aprobar: true, p_monto: 5, p_respuesta: null, p_admin: ana.id })).error).not.toBeNull();
  });
});
