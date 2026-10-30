/**
 * G6: ingesta de PDFs y búsqueda por audiencia contra el Supabase local (Storage + 0007_conocimiento.sql).
 * Sube PDFs ficticios generados en la prueba, los procesa sin embeddings y busca con sesiones reales.
 * Se salta si no hay service_role (CI sin base).
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fragmentar } from "@/lib/conocimiento/fragmentar";
import { BUCKET, procesarDocumento } from "@/lib/conocimiento/procesar";
import { elegirCitas, esRelevante, type Encontrado } from "@/lib/conocimiento/tipos";
import { ESTUDIO_FICTICIO, pdfDePrueba } from "./pdf-prueba";
import { codigoTotp } from "./totp";

describe("fragmentar", () => {
  it("no cruza páginas, respeta el tamaño y descarta páginas casi vacías", () => {
    const larga = Array.from({ length: 40 }, (_, i) => `Oración número ${i} sobre el canal mayoreo y el café.`).join(" ");
    const f = fragmentar([larga, "pág. 2", "Texto corto pero suficiente para un fragmento de la página tres."]);
    expect(f.every((x) => x.texto.length <= 1200)).toBe(true);
    expect(f.filter((x) => x.pagina === 1).length).toBeGreaterThan(1);
    expect(f.some((x) => x.pagina === 2)).toBe(false);
    expect(f.at(-1)).toMatchObject({ pagina: 3 });
    expect(f.map((x) => x.orden)).toEqual(f.map((_, i) => i + 1));
  });
  it("une palabras partidas con guion al final de línea", () => {
    expect(fragmentar(["La distribu-\nción del café en mayoreo cambió durante el trimestre."])[0].texto).toContain("distribución");
  });
});

describe("relevancia de citas", () => {
  const base: Encontrado = { fragmento_id: 1, documento_id: "a", titulo: "t", fuente: "f", fecha_documento: null, pagina: 1, texto: "x", coincidencias: 1, terminos: 4, similitud: null, puntaje: 0.01 };
  it("pide 2 términos en común (o uno si la pregunta tiene uno) o cercanía semántica", () => {
    expect(esRelevante(base)).toBe(false);
    expect(esRelevante({ ...base, coincidencias: 2 })).toBe(true);
    expect(esRelevante({ ...base, terminos: 1 })).toBe(true);
    expect(esRelevante({ ...base, similitud: 0.7 })).toBe(true);
  });
  it("prefiere un fragmento por documento", () => {
    const e = (id: number, doc: string): Encontrado => ({ ...base, fragmento_id: id, documento_id: doc, coincidencias: 3 });
    expect(elegirCitas([e(1, "a"), e(2, "a"), e(3, "b")], 2).map((c) => c.documentoId)).toEqual(["a", "b"]);
  });
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!url || !anon || !service)("ingesta y búsqueda de documentos", () => {
  let svc: SupabaseClient;
  const docs: string[] = [], usuarios: string[] = [];

  async function subir(titulo: string, audiencia: "estandar" | "plus", bytes: Uint8Array) {
    const id = crypto.randomUUID(), ruta = `pruebas/${id}.pdf`;
    const ins = await svc.schema("conocimiento").from("documento").insert({ id, titulo, fuente: "Prueba automatizada", audiencia, ruta_archivo: ruta, nombre_archivo: "prueba.pdf" });
    if (ins.error) throw ins.error;
    docs.push(id);
    const up = await svc.storage.from(BUCKET).upload(ruta, bytes, { contentType: "application/pdf" });
    if (up.error) throw up.error;
    return id;
  }

  async function sesion(nivel: "estandar" | "plus") {
    const email = `prueba-docs-${nivel}-${Date.now()}@bia.test`, password = randomBytes(12).toString("hex") + "a1";
    const { data } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    usuarios.push(data.user!.id);
    await svc.from("perfil").insert({ user_id: data.user!.id, nombre: nivel, nivel });
    const sb = createClient(url!, anon!, opciones);
    await sb.auth.signInWithPassword({ email, password });
    const alta = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "prueba" });
    await sb.auth.mfa.challengeAndVerify({ factorId: alta.data!.id, code: codigoTotp(alta.data!.totp.secret) });
    return sb;
  }

  beforeAll(() => {
    svc = createClient(url!, service!, opciones);
  });

  afterAll(async () => {
    if (docs.length) {
      await svc.storage.from(BUCKET).remove(docs.map((id) => `pruebas/${id}.pdf`));
      await svc.schema("conocimiento").from("documento").delete().in("id", docs);
    }
    for (const id of usuarios) await svc.auth.admin.deleteUser(id);
  });

  it("procesa un PDF con texto: páginas, fragmentos y estado listo", async () => {
    const id = await subir("Estudio ficticio estándar", "estandar", pdfDePrueba(ESTUDIO_FICTICIO));
    const r = await procesarDocumento(svc, id, null);
    expect(r).toEqual({ estado: "listo", fragmentos: 2, conEmbeddings: false });
    const d = await svc.schema("conocimiento").from("documento").select("estado, paginas, sha256").eq("id", id).single();
    expect(d.data).toMatchObject({ estado: "listo", paginas: 2 });
    expect(d.data!.sha256).toHaveLength(64);
  });

  it("rechaza el mismo archivo dos veces, un PDF sin texto y lo que no es PDF", async () => {
    const dup = await subir("Duplicado", "estandar", pdfDePrueba(ESTUDIO_FICTICIO));
    expect(await procesarDocumento(svc, dup, null)).toEqual({ estado: "error", error: "Este archivo ya está cargado como «Estudio ficticio estándar»." });
    const vacio = await subir("Sin texto", "estandar", pdfDePrueba([[""]]));
    expect(await procesarDocumento(svc, vacio, null)).toMatchObject({ estado: "error", error: expect.stringMatching(/no tiene texto/) });
    const falso = await subir("No es PDF", "estandar", new TextEncoder().encode("hola, no soy un pdf"));
    expect(await procesarDocumento(svc, falso, null)).toEqual({ estado: "error", error: "El archivo no es un PDF." });
  });

  it("Estándar encuentra los documentos estándar y no los Plus; Plus ve los dos", async () => {
    const plus = await subir("Estudio ficticio Plus", "plus", pdfDePrueba([["DOCUMENTO DE PRUEBA - ficticio", "Detalle Plus: los mayoristas del norte compran café molido cada quince días."]]));
    expect((await procesarDocumento(svc, plus, null)).estado).toBe("listo");
    const pregunta = "¿Qué dicen los estudios del café molido en mayoreo?";
    const est = await (await sesion("estandar")).schema("conocimiento").rpc("buscar", { p_texto: pregunta });
    expect(est.error).toBeNull();
    const titulosEst = new Set(est.data.map((e: Encontrado) => e.titulo));
    expect(titulosEst.has("Estudio ficticio estándar")).toBe(true);
    expect(titulosEst.has("Estudio ficticio Plus")).toBe(false);
    const pl = await (await sesion("plus")).schema("conocimiento").rpc("buscar", { p_texto: pregunta });
    expect(new Set(pl.data.map((e: Encontrado) => e.titulo)).has("Estudio ficticio Plus")).toBe(true);
    // La búsqueda ignora tildes y mayúsculas y cita la página.
    const lluvias = est.data.find((e: Encontrado) => /lluvias/.test(e.texto) && e.titulo === "Estudio ficticio estándar");
    expect(lluvias?.pagina).toBe(1);
  });

  it("sin sesión con 2FA no hay búsqueda ni lista; las tablas no se leen directo", async () => {
    const anonimo = createClient(url!, anon!, opciones);
    expect((await anonimo.schema("conocimiento").rpc("buscar", { p_texto: "café" })).error).not.toBeNull();
    expect((await anonimo.schema("conocimiento").rpc("documentos")).error).not.toBeNull();
    const est = await sesion("estandar");
    expect((await est.schema("conocimiento").from("fragmento").select("texto").limit(1)).error).not.toBeNull();
    expect((await est.storage.from(BUCKET).list("pruebas")).data ?? []).toEqual([]);
  });
});
