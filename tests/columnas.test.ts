/**
 * Columnas del Excel configurables (G10, S26): lectura de encabezados por nombre, sin la base.
 * La ingesta con la base (alias, columnas que faltan, fila de encabezados) está en cargas.test.ts.
 */
import { describe, expect, it } from "vitest";
import { CAMPOS, camposVacios, ENCABEZADOS_CUBO, esDeFabrica, GRUPOS, hojaExcluida, leerEncabezados, motivoHoja, NOMBRE_CUBO, normalizarEncabezado, revertibles, sugerencias, type CambioColumnas, type Campo, type MapeoCarga } from "@/lib/cargas/columnas";

const INICIAL: Record<Campo, string> = {
  fecha: "Fecha", ruta: "Ruta", empresa: "Empresa", marca: "Marca", categoria: "Café/Rep", proveedor: "Proveedor", cliente_codigo: "Cliente Codigo",
  cliente_nombre: "Cliente Nombre", zona: "Zona", documento: "Documento", grupo: "Grupo", canal_origen: "Canal BIA", art_codigo: "ArtCodigo",
  art_descrip: "ArtDescrip", cantidad: "Cantidad", venta_bruta: "Venta Bruta", descuentos: "Descuentos", venta_neta: "Venta Neta", kg: "Kg",
  fardos_caja: "Fardos/Caja", subgrupo: "Subgrupo", sucursal: "Sucursal",
};
const OPCIONALES = new Set<Campo>(["proveedor", "cliente_nombre", "zona", "grupo", "art_descrip", "fardos_caja", "subgrupo", "sucursal"]);

/** La configuración inicial de 0019 (todas obligatorias), con cambios opcionales por campo. */
function mapeo(cambios: Partial<Record<Campo, { encabezados?: string[]; obligatoria?: boolean }>> = {}): MapeoCarga {
  return {
    filaEncabezado: 1, hojasExcluidas: ["Desgloce"],
    columnas: (Object.keys(CAMPOS) as Campo[]).map((campo) => ({
      campo, encabezados: cambios[campo]?.encabezados ?? [INICIAL[campo]], obligatoria: cambios[campo]?.obligatoria ?? true, puede_faltar: OPCIONALES.has(campo),
    })),
  };
}

describe("columnas del Excel", () => {
  it("normaliza mayúsculas, tildes, espacios y signos igual que la base", () => {
    expect(normalizarEncabezado("  Café/Rep ")).toBe("cafe rep");
    expect(normalizarEncabezado("CAFE - REP")).toBe("cafe rep");
    expect(normalizarEncabezado("Datos café")).toBe("datos cafe");
    expect(normalizarEncabezado("Año")).toBe("ano");
    expect(normalizarEncabezado("—")).toBe("");
  });

  it("la exportación del cubo se lee completa; Año y Mes Nom quedan sin usar", () => {
    const l = leerEncabezados([...ENCABEZADOS_CUBO], mapeo());
    expect(l.valida).toBe(true);
    expect(l.encontrados).toHaveLength(22);
    expect(l.indices.categoria).toBe(4);
    expect(l.indices.venta_neta).toBe(19);
    expect(l.sinUsar).toEqual(["Año", "Mes Nom"]);
  });

  it("no importa el orden ni cómo se escriban los encabezados", () => {
    const cab = [...ENCABEZADOS_CUBO].reverse().map((e) => e.toUpperCase());
    const l = leerEncabezados(cab, mapeo());
    expect(l.valida).toBe(true);
    expect(cab[l.indices.fecha!]).toBe("FECHA");
    expect(cab[l.indices.categoria!]).toBe("CAFÉ/REP");
  });

  it("un nombre agregado (Datos café) llena el campo", () => {
    const cab = ENCABEZADOS_CUBO.map((e) => (e === "Café/Rep" ? "Datos café" : e));
    expect(leerEncabezados(cab, mapeo()).faltan).toEqual(["categoria"]);
    const l = leerEncabezados(cab, mapeo({ categoria: { encabezados: ["Café/Rep", "DATOS CAFE"] } }));
    expect(l.valida).toBe(true);
    expect(l.encontrados.find((e) => e.campo === "categoria")).toEqual({ campo: "categoria", encabezado: "Datos café", columna: 4, alternativo: true });
  });

  it("falta una obligatoria: la hoja no se carga y el motivo dice qué se acepta y qué trae", () => {
    const m = mapeo({ venta_neta: { encabezados: ["Venta Neta", "Net Sales"] } });
    const cab = ENCABEZADOS_CUBO.filter((e) => e !== "Venta Neta");
    const l = leerEncabezados(cab, m);
    expect(l).toMatchObject({ valida: false, faltan: ["venta_neta"] });
    const motivo = motivoHoja("Hoja1", l, m, cab);
    expect(motivo).toMatch(/Hoja «Hoja1» \(fila 1\): falta la columna de venta neta \(se acepta como «Venta Neta», «Net Sales»\)/);
    expect(motivo).toMatch(/Encabezados del archivo: «Fecha», «Ruta»/);
  });

  it("falta una opcional: se carga y queda anotada", () => {
    const cab = ENCABEZADOS_CUBO.filter((e) => e !== "Sucursal" && e !== "Zona");
    expect(leerEncabezados(cab, mapeo()).valida).toBe(false);
    const l = leerEncabezados(cab, mapeo({ sucursal: { obligatoria: false }, zona: { obligatoria: false } }));
    expect(l).toMatchObject({ valida: true, faltan: [], faltanOpcionales: ["zona", "sucursal"] });
  });

  it("nombre principal y alternativos: se usa el de mayor prioridad que venga", () => {
    const m = mapeo({ kg: { encabezados: ["Kg", "Kilos", "Peso"] } });
    // Viene el principal y un alternativo: gana el principal, el otro queda descartado (no es error).
    const ambos = leerEncabezados([...ENCABEZADOS_CUBO, "Kilos"], m);
    expect(ambos).toMatchObject({ valida: true, repetidos: [], descartadas: [{ campo: "kg", encabezado: "Kilos", usada: "Kg" }] });
    expect(ambos.encontrados.find((e) => e.campo === "kg")).toMatchObject({ encabezado: "Kg", alternativo: false });
    // Sin el principal: el primer alternativo que venga, aunque esté más a la izquierda uno de menor prioridad.
    const sinPrincipal = ["PESO", ...ENCABEZADOS_CUBO.filter((e) => e !== "Kg"), "kilos"];
    const l = leerEncabezados(sinPrincipal, m);
    expect(l.valida).toBe(true);
    expect(l.encontrados.find((e) => e.campo === "kg")).toMatchObject({ encabezado: "kilos", alternativo: true, columna: sinPrincipal.length - 1 });
    expect(l.descartadas).toEqual([{ campo: "kg", encabezado: "PESO", usada: "kilos" }]);
  });

  it("el mismo nombre en dos columnas: no se adivina cuál usar", () => {
    const m = mapeo({ kg: { encabezados: ["Kg", "Kilos"] } });
    const cab = [...ENCABEZADOS_CUBO, "KG"];
    const l = leerEncabezados(cab, m);
    expect(l).toMatchObject({ valida: false, repetidos: [{ campo: "kg", encabezados: ["Kg", "KG"] }] });
    expect(motivoHoja("Hoja1", l, m, cab)).toMatch(/hay dos columnas con el mismo nombre para kilos: «Kg», «KG»/);
  });

  it("encabezados vacíos no cuentan y las hojas excluidas se comparan normalizadas", () => {
    const l = leerEncabezados(["", ...ENCABEZADOS_CUBO, "  "], mapeo());
    expect(l.valida).toBe(true);
    expect(l.sinUsar).toEqual(["Año", "Mes Nom"]);
    expect(hojaExcluida("DESGLOCE", mapeo())).toBe(true);
    expect(hojaExcluida("Hoja1", mapeo())).toBe(false);
    // Un nombre terminado en «*» salta las hojas que empiezan así: los resúmenes cambian de mes en el nombre.
    const m = mapeo();
    m.hojasExcluidas = ["Desgloce", "1. Venta-Kilos x Canal*", "3.Ene025*", "*"];
    expect(["1. Venta-Kilos x Canal Sep 026", "1. VENTA KILOS X CANAL OCT 026", "3.Ene025-Oct026"].map((h) => hojaExcluida(h, m))).toEqual([true, true, true]);
    expect(["2.Cierre Oct 026", "Hoja1"].map((h) => hojaExcluida(h, m))).toEqual([false, false]); // «*» solo no salta todo
  });

  it("columnas opcionales que no vinieron, en palabras para la alerta", () => {
    expect(camposVacios(null)).toEqual([]);
    expect(camposVacios([{ hoja: "Hoja1", campos: {}, faltan_opcionales: ["sucursal"], sin_usar: [] }, { hoja: "Resumen", ignorada: "x" }])).toEqual(["«Sucursal»"]);
    expect(camposVacios([
      { hoja: "Norte", campos: {}, faltan_opcionales: ["sucursal"], sin_usar: [] },
      { hoja: "Sur", campos: {}, faltan_opcionales: ["sucursal", "zona"], sin_usar: [] },
    ])).toEqual(["«Sucursal» (hoja «Norte», «Sur»)", "«Zona» (hoja «Sur»)"]);
  });

  it("sugiere la columna que sobra para el dato que falta, si se parece", () => {
    const m = mapeo({ zona: { obligatoria: false } });
    const cab = ENCABEZADOS_CUBO.map((e) => ({ "Kg": "Kilos", "Café/Rep": "Datos café", "Cliente Codigo": "Cliente Cod", "Zona": "Otra cosa" } as Record<string, string>)[e] ?? e);
    const l = leerEncabezados(cab, m);
    expect(l.faltan).toEqual(["cliente_codigo", "categoria", "kg"].sort((a, b) => Object.keys(CAMPOS).indexOf(a) - Object.keys(CAMPOS).indexOf(b)));
    expect(sugerencias(l, m)).toEqual(expect.arrayContaining([
      { campo: "kg", encabezado: "Kilos" }, { campo: "categoria", encabezado: "Datos café" }, { campo: "cliente_codigo", encabezado: "Cliente Cod" },
    ]));
    // «Año», «Mes Nom» y «Otra cosa» no se parecen a nada que falte.
    expect(sugerencias(l, m).map((s) => s.encabezado)).not.toContain("Otra cosa");
  });

  it("los grupos cubren los 22 datos una sola vez y el nombre del cubo es el inicial", () => {
    const todos = GRUPOS.flatMap((g) => g.campos);
    expect(new Set(todos).size).toBe(22);
    expect(todos.sort()).toEqual(Object.keys(CAMPOS).sort());
    expect(Object.values(NOMBRE_CUBO).every((n) => (ENCABEZADOS_CUBO as readonly string[]).includes(n))).toBe(true);
  });

  it("de fábrica: solo el nombre del cubo y obligatoria", () => {
    const m = mapeo({ kg: { encabezados: ["Kg", "Kilos"] }, zona: { obligatoria: false } });
    const de = (c: Campo) => esDeFabrica(m.columnas.find((x) => x.campo === c)!);
    expect([de("fecha"), de("kg"), de("zona")]).toEqual([true, false, false]);
  });

  it("solo se deshace el último cambio de cada dato, y si nada lo cambió después", () => {
    const cambio = (id: number, campo: string | null, antes: CambioColumnas["antes"], despues: CambioColumnas["despues"]): CambioColumnas =>
      ({ id, tipo: campo ? "columna" : "formato", campo, antes, despues, usuario: null, creado_en: `2026-11-08T10:0${id}:00Z` });
    const m = mapeo({ kg: { encabezados: ["Kg", "Kilos"] } });
    m.hojasExcluidas = ["Desgloce", "Resumen"];
    const cambios = [
      cambio(1, "kg", { encabezados: ["Kg"], obligatoria: true }, { encabezados: ["Kg", "Peso"], obligatoria: true }),
      cambio(2, "kg", { encabezados: ["Kg", "Peso"], obligatoria: true }, { encabezados: ["Kg", "Kilos"], obligatoria: true }),
      cambio(3, "zona", { encabezados: ["Zona"], obligatoria: true }, { encabezados: ["Zona", "Región"], obligatoria: true }),
      cambio(4, null, { fila_encabezado: 1, hojas_excluidas: ["Desgloce"] }, { fila_encabezado: 1, hojas_excluidas: ["Desgloce", "Resumen"] }),
    ];
    // 1: hubo otro cambio de kg después. 2: es el último y sigue vigente. 3: zona ya no tiene «Región» (cambió por fuera). 4: formato vigente.
    expect([...revertibles(cambios, m)].sort()).toEqual([2, 4]);
  });
});
