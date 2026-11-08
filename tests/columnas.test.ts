/**
 * Columnas del Excel configurables (G10, S26): lectura de encabezados por nombre, sin la base.
 * La ingesta con la base (alias, columnas que faltan, fila de encabezados) está en cargas.test.ts.
 */
import { describe, expect, it } from "vitest";
import { CAMPOS, camposVacios, ENCABEZADOS_CUBO, hojaExcluida, leerEncabezados, motivoHoja, normalizarEncabezado, type Campo, type MapeoCarga } from "@/lib/cargas/columnas";

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
    expect(l.encontrados.find((e) => e.campo === "categoria")).toEqual({ campo: "categoria", encabezado: "Datos café", columna: 4 });
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

  it("dos columnas para el mismo dato: no se adivina cuál usar", () => {
    const m = mapeo({ kg: { encabezados: ["Kg", "Kilos"] } });
    const l = leerEncabezados([...ENCABEZADOS_CUBO, "Kilos"], m);
    expect(l).toMatchObject({ valida: false, repetidos: [{ campo: "kg", encabezados: ["Kg", "Kilos"] }] });
    expect(motivoHoja("Hoja1", l, m, [...ENCABEZADOS_CUBO, "Kilos"])).toMatch(/hay varias columnas de kilos: «Kg», «Kilos»/);
  });

  it("encabezados vacíos no cuentan y las hojas excluidas se comparan normalizadas", () => {
    const l = leerEncabezados(["", ...ENCABEZADOS_CUBO, "  "], mapeo());
    expect(l.valida).toBe(true);
    expect(l.sinUsar).toEqual(["Año", "Mes Nom"]);
    expect(hojaExcluida("DESGLOCE", mapeo())).toBe(true);
    expect(hojaExcluida("Hoja1", mapeo())).toBe(false);
  });

  it("columnas opcionales que no vinieron, en palabras para la alerta", () => {
    expect(camposVacios(null)).toEqual([]);
    expect(camposVacios([{ hoja: "Hoja1", campos: {}, faltan_opcionales: ["sucursal"], sin_usar: [] }, { hoja: "Resumen", ignorada: "x" }])).toEqual(["«Sucursal»"]);
    expect(camposVacios([
      { hoja: "Norte", campos: {}, faltan_opcionales: ["sucursal"], sin_usar: [] },
      { hoja: "Sur", campos: {}, faltan_opcionales: ["sucursal", "zona"], sin_usar: [] },
    ])).toEqual(["«Sucursal» (hoja «Norte», «Sur»)", "«Zona» (hoja «Sur»)"]);
  });
});
