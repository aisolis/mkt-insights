/**
 * Glosario recuperable: qué términos se envían al modelo según la pregunta, cómo se validan y cómo se leen desde
 * Excel o CSV. Y lectura de documentos de conocimiento que no son PDF (Word, Excel, texto). Sin base de datos.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EntradaTermino, lineaGlosario, terminosEnPregunta, type TerminoGlosario } from "@/lib/asistente/glosario";
import { glosarioDeTabla, leerGlosario, tablaCsv } from "@/lib/asistente/glosario-archivo";
import { sistema } from "@/lib/asistente/modelo";
import type { Contexto } from "@/lib/asistente/tipos";
import { extraerPaginas, firmaInvalida, secciones } from "@/lib/conocimiento/extraer";
import { fragmentar } from "@/lib/conocimiento/fragmentar";
import { BUCKET, procesarDocumento } from "@/lib/conocimiento/procesar";
import { TIPOS, tipoDeArchivo, type Encontrado } from "@/lib/conocimiento/tipos";
import { codigoTotp } from "./totp";

const t = (termino: string, definicion: string, sinonimos: string[] = []): TerminoGlosario => ({ id: termino, termino, sinonimos, definicion });
const GLOSARIO = [
  t("Ticket", "Venta neta dividida entre el número de facturas.", ["ticket promedio", "factura promedio"]),
  t("Venta neta", "Venta bruta menos descuentos."),
  t("Venta", "Monto facturado."),
  t("Ruta", "Recorrido de un vendedor con sus clientes asignados."),
  t("Canal Moderno", "Supermercados y cadenas.", ["moderno"]),
  t("Fardo", "Unidad de empaque de varias bolsas."),
];
const nombres = (textos: string[], max?: number) => terminosEnPregunta(textos, GLOSARIO, max).map((x) => x.termino);

describe("términos del glosario en la pregunta", () => {
  it("encuentra el término sin tildes ni mayúsculas, como palabra completa y con plural simple", () => {
    expect(nombres(["¿Cómo va el TICKET este mes?"])).toEqual(["Ticket"]);
    expect(nombres(["¿Cuántas rutas vendieron?"])).toEqual(["Ruta"]);
    expect(nombres(["¿Qué pasó con los fardos?"])).toEqual(["Fardo"]);
    expect(nombres(["¿Y la ticketera?"])).toEqual([]); // no es la palabra completa
    expect(nombres(["¿Cómo cerró el mes?"])).toEqual([]);
  });

  it("encuentra por sinónimo y pone primero el nombre más específico", () => {
    expect(nombres(["¿Subió la factura promedio en moderno?"])).toEqual(["Ticket", "Canal Moderno"]);
    expect(nombres(["¿Cuál fue la venta neta?"])).toEqual(["Venta neta", "Venta"]);
  });

  it("la pregunta anterior aporta términos, después de los de la pregunta actual, y se respeta el máximo", () => {
    expect(nombres(["¿Y eso cómo se calcula en moderno?", "¿Cómo va el ticket?"])).toEqual(["Canal Moderno", "Ticket"]);
    expect(nombres(["ticket, venta neta, ruta y fardo en moderno"], 2)).toHaveLength(2);
  });

  it("la línea para el modelo lleva término, sinónimos y definición", () => {
    expect(lineaGlosario(GLOSARIO[0])).toBe("- Ticket (también: ticket promedio, factura promedio): Venta neta dividida entre el número de facturas.");
    expect(lineaGlosario(GLOSARIO[1])).toBe("- Venta neta: Venta bruta menos descuentos.");
  });
});

describe("validación de un término", () => {
  it("deja una línea, quita sinónimos repetidos y el propio término", () => {
    const r = EntradaTermino.parse({ termino: "  Ticket \n promedio ", definicion: "Venta  neta /\nfacturas", sinonimos: ["ticket promedio", "TICKET", "Tícket", " ", "factura promedio"] });
    expect(r).toEqual({ termino: "Ticket promedio", definicion: "Venta neta / facturas", sinonimos: ["TICKET", "factura promedio"] });
  });
  it("rechaza términos o definiciones vacíos o demasiado largos", () => {
    expect(EntradaTermino.safeParse({ termino: "a", definicion: "algo" }).success).toBe(false);
    expect(EntradaTermino.safeParse({ termino: "ok", definicion: "x".repeat(501) }).success).toBe(false);
    expect(EntradaTermino.safeParse({ termino: "¿?", definicion: "solo signos" }).success).toBe(false);
  });
});

describe("el glosario en las instrucciones del modelo", () => {
  const ctx: Contexto = {
    fuente: {} as Contexto["fuente"],
    version: {
      version: 1, fecha_corte: "2026-01-31", conciliada_bi: false, publicado_en: "2026-01-31T00:00:00Z", archivo: "",
      metadatos: { periodos: [{ anio: 2026, mes: 1, dias: 31, ultimo_dia: "2026-01-31", cerrado: true }], canal: [], ruta: [], marca: [], producto: [], rutas_total: 0 },
    },
    estado: { periodo: { anio: 2026, mes: 1 }, comparar: "anterior", filtros: {} },
  };
  it("sin términos no cambia nada; con términos agrega solo esas definiciones", () => {
    expect(sistema({ ...ctx, glosario: [] })).toBe(sistema(ctx));
    const con = sistema({ ...ctx, glosario: [GLOSARIO[0]] });
    expect(con).toContain("Glosario de BIA que aplica a esta pregunta");
    expect(con).toContain(lineaGlosario(GLOSARIO[0]));
    expect(con).not.toContain("Recorrido de un vendedor");
    expect(con.split("\n").length - sistema(ctx).split("\n").length).toBe(2);
  });
});

describe("glosario desde un archivo", () => {
  it("lee un CSV con punto y coma, comillas y sinónimos", () => {
    const tabla = tablaCsv('Término;Sinónimos;Definición\r\nTicket;"ticket promedio; factura promedio";"Venta neta / facturas; ""promedio"" por factura"\r\nRuta;;Recorrido de un vendedor\r\n');
    const r = glosarioDeTabla(tabla);
    expect(r.error).toBeUndefined();
    if (r.error !== undefined) return;
    expect(r.errores).toEqual([]);
    expect(r.filas).toEqual([
      { termino: "Ticket", sinonimos: ["ticket promedio", "factura promedio"], definicion: 'Venta neta / facturas; "promedio" por factura' },
      { termino: "Ruta", sinonimos: [], definicion: "Recorrido de un vendedor" },
    ]);
  });

  it("lee un Excel con filas de título antes de los encabezados y señala las filas con problema", async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet("Glosario");
    hoja.addRow(["Glosario comercial BIA"]);
    hoja.addRow([]);
    hoja.addRow(["Concepto", "Definición", "Alias"]);
    hoja.addRow(["Fardo", "Unidad de empaque de varias bolsas.", "fardos, bulto"]);
    hoja.addRow(["X", "Término de una sola letra", ""]);
    hoja.addRow(["Sell out", "", ""]);
    const r = await leerGlosario(new Uint8Array(await libro.xlsx.writeBuffer()), "glosario.xlsx");
    expect(r.error).toBeUndefined();
    if (r.error !== undefined) return;
    expect(r.filas).toEqual([{ termino: "Fardo", sinonimos: ["fardos", "bulto"], definicion: "Unidad de empaque de varias bolsas." }]);
    expect(r.errores).toHaveLength(2);
    expect(r.errores[0]).toMatch(/^Fila 5 \(«X»\)/);
    expect(r.errores[1]).toMatch(/^Fila 6 \(«Sell out»\)/);
  });

  it("explica qué falta si no hay encabezados o el archivo no es del tipo esperado", async () => {
    expect(glosarioDeTabla([["Ticket", "Venta neta / facturas"]])).toMatchObject({ error: expect.stringMatching(/encabezados/) });
    expect(await leerGlosario(new TextEncoder().encode("hola"), "glosario.xlsx")).toMatchObject({ error: expect.stringMatching(/no es un Excel/) });
    expect(await leerGlosario(new TextEncoder().encode("hola"), "glosario.pdf")).toMatchObject({ error: expect.stringMatching(/Excel \(\.xlsx\) o CSV/) });
  });
});

// Contra la base (0030_glosario_y_formatos.sql). Se salta si no hay service_role (CI sin base). ----------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!url || !anon || !service)("glosario y formatos en la base", () => {
  let svc: SupabaseClient;
  const marca = `zzprueba${Date.now()}`; // términos de esta corrida, para borrarlos al final
  const docs: { id: string; ruta: string }[] = [], usuarios: string[] = [];

  async function sesion() {
    const email = `prueba-glosario-${Date.now()}@bia.test`, password = randomBytes(12).toString("hex") + "a1";
    const { data } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    usuarios.push(data.user!.id);
    await svc.from("perfil").insert({ user_id: data.user!.id, nombre: "glosario", nivel: "estandar" });
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
    await svc.schema("ventas").from("termino_glosario").delete().like("clave", `${marca}%`);
    if (docs.length) {
      await svc.storage.from(BUCKET).remove(docs.map((d) => d.ruta));
      await svc.schema("conocimiento").from("documento").delete().in("id", docs.map((d) => d.id));
    }
    for (const id of usuarios) await svc.auth.admin.deleteUser(id);
  });

  it("importar crea los nuevos, actualiza los existentes por término (sin tildes ni mayúsculas) y no duplica", async () => {
    const tabla = () => svc.schema("ventas").from("termino_glosario");
    const a = await svc.schema("ventas").rpc("importar_glosario", { p_filas: [
      { termino: `${marca} Tícket`, sinonimos: ["uno", "dos"], definicion: "Primera definición." },
      { termino: `${marca} ruta`, sinonimos: [], definicion: "Recorrido." },
    ] });
    expect(a.error).toBeNull();
    expect(a.data).toEqual({ nuevos: 2, actualizados: 0 });
    // Mismo término con otra escritura y repetido en el archivo: queda la última fila.
    const b = await svc.schema("ventas").rpc("importar_glosario", { p_filas: [
      { termino: `${marca} TICKET`, sinonimos: [], definicion: "Se descarta." },
      { termino: `${marca} ticket`, sinonimos: ["tres"], definicion: "Definición nueva." },
      { termino: `${marca} fardo`, sinonimos: [], definicion: "Empaque." },
    ] });
    expect(b.data).toEqual({ nuevos: 1, actualizados: 1 });
    const filas = await tabla().select("termino, sinonimos, definicion, activo").like("clave", `${marca}%`).order("clave");
    expect(filas.data).toEqual([
      { termino: `${marca} fardo`, sinonimos: [], definicion: "Empaque.", activo: true },
      { termino: `${marca} ruta`, sinonimos: [], definicion: "Recorrido.", activo: true },
      { termino: `${marca} ticket`, sinonimos: ["tres"], definicion: "Definición nueva.", activo: true },
    ]);
    // Agregar a mano un término que ya existe choca con la llave única.
    expect((await tabla().insert({ termino: `${marca} RUTA`, definicion: "Otra." })).error?.code).toBe("23505");
  });

  it("una persona con sesión no lee ni cambia el glosario directamente", async () => {
    const sb = await sesion();
    expect((await sb.schema("ventas").from("termino_glosario").select("termino").limit(1)).error).not.toBeNull();
    expect((await sb.schema("ventas").rpc("importar_glosario", { p_filas: [] })).error).not.toBeNull();
  });

  it("procesa un Word y un Markdown, y la búsqueda devuelve el tipo y la sección", async () => {
    async function subir(titulo: string, tipo: "docx" | "md", bytes: Uint8Array) {
      const id = crypto.randomUUID(), ruta = `pruebas/${id}.${tipo}`;
      const ins = await svc.schema("conocimiento").from("documento").insert({ id, titulo, fuente: "Prueba automatizada", audiencia: "estandar", ruta_archivo: ruta, nombre_archivo: `prueba.${tipo}`, tipo });
      if (ins.error) throw ins.error;
      docs.push({ id, ruta });
      const up = await svc.storage.from(BUCKET).upload(ruta, bytes, { contentType: TIPOS[tipo].mime });
      if (up.error) throw up.error;
      return id;
    }
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document xmlns:w="x"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Estudio ${marca}</w:t></w:r></w:p>`
      + `<w:p><w:r><w:t>Los zapateros artesanales de ${marca} toman café de olla durante la jornada de trabajo en el taller.</w:t></w:r></w:p></w:body></w:document>`);
    const word = await subir(`Word ${marca}`, "docx", await zip.generateAsync({ type: "uint8array" }));
    expect(await procesarDocumento(svc, word, null)).toEqual({ estado: "listo", fragmentos: 1, conEmbeddings: false });

    const md = await subir(`Markdown ${marca}`, "md", new TextEncoder().encode(
      `# Notas ${marca}\n\nIntroducción breve sobre el estudio de hábitos, sin más detalle que este párrafo.\n\n## Talleres\n\nEn los talleres de ${marca} el café instantáneo desplaza al café de olla por rapidez.`));
    expect(await procesarDocumento(svc, md, null)).toEqual({ estado: "listo", fragmentos: 2, conEmbeddings: false });
    expect((await svc.schema("conocimiento").from("documento").select("paginas").eq("id", md).single()).data).toEqual({ paginas: 2 });

    // Un PDF con extensión .docx se rechaza por su contenido.
    const falso = await subir(`Falso ${marca}`, "docx", new TextEncoder().encode("%PDF-1.4 no soy un word"));
    expect(await procesarDocumento(svc, falso, null)).toMatchObject({ estado: "error", error: expect.stringMatching(/no es un Word/) });

    const r = await (await sesion()).schema("conocimiento").rpc("buscar", { p_texto: `café de olla ${marca}` });
    expect(r.error).toBeNull();
    const propios = (r.data as Encontrado[]).filter((e) => e.titulo.endsWith(marca));
    expect(propios.find((e) => e.titulo.startsWith("Word"))).toMatchObject({ tipo: "docx", pagina: 1 });
    expect(propios.find((e) => e.titulo.startsWith("Markdown"))).toMatchObject({ tipo: "md", pagina: 2 });
    const lista = await (await sesion()).schema("conocimiento").rpc("documentos");
    expect((lista.data as { id: string; tipo: string }[]).find((d) => d.id === word)?.tipo).toBe("docx");
  });
});

describe("documentos que no son PDF", () => {
  it("reconoce el tipo por la extensión y revisa que el contenido corresponda", () => {
    expect(["a.PDF", "b.docx", "c.xlsx", "d.txt", "e.md", "f.doc", "g"].map(tipoDeArchivo)).toEqual(["pdf", "docx", "xlsx", "txt", "md", null, null]);
    const texto = new TextEncoder().encode("hola, soy texto");
    expect(firmaInvalida(texto, "txt")).toBeNull();
    expect(firmaInvalida(texto, "pdf")).toBe("El archivo no es un PDF.");
    expect(firmaInvalida(texto, "docx")).toMatch(/no es un Word/);
    expect(firmaInvalida(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), "txt")).toBe("El archivo no es de texto.");
  });

  it("Markdown: cada título abre una sección y el título queda con su texto", async () => {
    const md = "# Estudio de canales\n\nIntroducción general del estudio.\n\n## Mayoreo\n\nLos mayoristas compran café molido cada quince días.\n\n## Detalle\n\nLas pulperías compran sobres pequeños.";
    const paginas = await extraerPaginas(new TextEncoder().encode(md), "md");
    expect(paginas).toHaveLength(3);
    expect(paginas[1]).toBe("Mayoreo\n\nLos mayoristas compran café molido cada quince días.");
    expect(fragmentar(paginas).map((f) => f.pagina)).toEqual([1, 2, 3]);
  });

  it("texto sin títulos: corta en secciones de tamaño acotado sin partir párrafos", () => {
    const parrafo = "Oración sobre el canal mayoreo y el café. ".repeat(30).trim(); // ~1,250 caracteres
    const s = secciones(Array.from({ length: 5 }, () => ({ texto: parrafo, titulo: false })));
    expect(s.length).toBe(3);
    expect(s.every((x) => x.length <= 3000)).toBe(true);
  });

  it("texto en Windows-1252 (sin UTF-8) conserva las tildes", async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("El caf"), 0xe9, ...new TextEncoder().encode(" molido se vende en pulper"), 0xed, ...new TextEncoder().encode("as del norte del pa"), 0xed, 0x73])
    expect((await extraerPaginas(bytes, "txt"))[0]).toBe("El café molido se vende en pulperías del norte del país");
  });

  it("Word: párrafos, títulos por estilo, entidades y tablas como «celda | celda»", async () => {
    const p = (texto: string, estilo?: string) => `<w:p w:rsidR="00A1">${estilo ? `<w:pPr><w:pStyle w:val="${estilo}"/></w:pPr>` : ""}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${texto}</w:t></w:r></w:p>`;
    const celda = (texto: string) => `<w:tc><w:tcPr><w:tcW w:w="100"/></w:tcPr>${p(texto)}</w:tc>`;
    const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${p("Hábitos de compra", "Ttulo1")}${p("El consumidor compra caf&#233; &amp; az&#xFA;car cada semana.")}`
      + `${p("Canal mayorista", "Heading2")}<w:p><w:r><w:t>Compran </w:t></w:r><w:r><w:t>por fardo</w:t><w:br/><w:t>y a crédito.</w:t></w:r></w:p>`
      + `<w:tbl><w:tblPr><w:tblStyle w:val="Tabla"/></w:tblPr><w:tr>${celda("Canal")}${celda("Frecuencia")}</w:tr><w:tr>${celda("Mayoreo")}${celda("Quincenal")}</w:tr></w:tbl><w:sectPr/></w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const paginas = await extraerPaginas(await zip.generateAsync({ type: "uint8array" }), "docx");
    expect(paginas).toEqual([
      "Hábitos de compra\n\nEl consumidor compra café & azúcar cada semana.",
      "Canal mayorista\n\nCompran por fardo\ny a crédito.\n\nCanal | Frecuencia\n\nMayoreo | Quincenal",
    ]);
  });

  it("Word: un zip sin document.xml se rechaza con un mensaje claro", async () => {
    const zip = new JSZip();
    zip.file("otro.txt", "hola");
    await expect(extraerPaginas(await zip.generateAsync({ type: "uint8array" }), "docx")).rejects.toThrow(/no es un Word/);
  });

  it("Excel: una página por hoja y cada fila con sus encabezados", async () => {
    const libro = new ExcelJS.Workbook();
    const precios = libro.addWorksheet("Lista de precios");
    precios.addRow(["Producto", "Presentación", "Precio"]);
    precios.addRow(["Café molido", "400 g", 85.5]);
    precios.addRow(["Café instantáneo", "", { formula: "1+1", result: 120 }]);
    libro.addWorksheet("Vacía");
    const notas = libro.addWorksheet("Notas");
    notas.addRow(["Los precios rigen desde enero y no incluyen impuesto."]);
    const paginas = await extraerPaginas(new Uint8Array(await libro.xlsx.writeBuffer()), "xlsx");
    expect(paginas).toEqual([
      "Hoja «Lista de precios»\nProducto: Café molido | Presentación: 400 g | Precio: 85.5\nProducto: Café instantáneo | Precio: 120",
      "",
      "Hoja «Notas»\nLos precios rigen desde enero y no incluyen impuesto.",
    ]);
    expect(fragmentar(paginas).map((f) => f.pagina)).toEqual([1, 3]); // la cita apunta al número de hoja
  });
});
