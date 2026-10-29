import { describe, it, expect } from "vitest";
import { advertencias, leerParams, periodoComparado, queryString } from "@/lib/dashboard/params";
import type { PeriodoMeta } from "@/lib/semantic/contracts";

const periodos: PeriodoMeta[] = [
  { anio: 2025, mes: 9, dias: 26, ultimo_dia: "2025-09-30", cerrado: true },
  { anio: 2026, mes: 1, dias: 26, ultimo_dia: "2026-01-31", cerrado: true },
  { anio: 2026, mes: 8, dias: 26, ultimo_dia: "2026-08-31", cerrado: true },
  { anio: 2026, mes: 9, dias: 26, ultimo_dia: "2026-09-30", cerrado: true },
  { anio: 2026, mes: 10, dias: 12, ultimo_dia: "2026-10-15", cerrado: false },
];

describe("leerParams", () => {
  it("sin parámetros toma el último mes cerrado (S7) contra el periodo anterior", () => {
    const p = leerParams({}, periodos);
    expect(p.periodo).toEqual({ anio: 2026, mes: 9 });
    expect(p.comparar).toBe("anterior");
    expect(p.filtros).toEqual({});
  });

  it("lee periodo, comparación y filtros; producto va a art_codigo", () => {
    const p = leerParams({ periodo: "2026-10", comparar: "anio", canal: "Mayoreo", ruta: "103 - WALMART ZC", marca: "ORO", producto: "1201" }, periodos);
    expect(p.periodo).toEqual({ anio: 2026, mes: 10 });
    expect(p.comparar).toBe("anio");
    expect(p.filtros).toEqual({ canal: "Mayoreo", ruta: "103 - WALMART ZC", marca: "ORO", art_codigo: "1201" });
  });

  it("ignora un periodo que no está en la versión y valores vacíos o repetidos", () => {
    const p = leerParams({ periodo: "2019-01", comparar: "x", canal: "", marca: ["ORO", "MAYA"] }, periodos);
    expect(p.periodo).toEqual({ anio: 2026, mes: 9 });
    expect(p.comparar).toBe("anterior");
    expect(p.filtros).toEqual({ marca: "ORO" });
  });
});

describe("periodoComparado", () => {
  it("mes anterior cruza el año", () => {
    expect(periodoComparado({ anio: 2026, mes: 1 }, "anterior")).toEqual({ anio: 2025, mes: 12 });
  });
  it("año anterior conserva el mes", () => {
    expect(periodoComparado({ anio: 2026, mes: 9 }, "anio")).toEqual({ anio: 2025, mes: 9 });
  });
});

describe("advertencias", () => {
  it("avisa mes parcial y sin certificar (S1) cuando aplica", () => {
    const a = advertencias({ anio: 2026, mes: 10 }, { anio: 2026, mes: 9 }, periodos);
    expect(a).toContain("Octubre 2026 parcial: 12 días con venta, corte 15-oct-2026.");
    expect(a.some((t) => t.includes("sin certificar"))).toBe(false);
    const b = advertencias({ anio: 2026, mes: 9 }, { anio: 2026, mes: 8 }, periodos);
    expect(b.some((t) => t.includes("Agosto 2026") && t.includes("sin certificar"))).toBe(true);
  });
  it("avisa cuando el periodo comparado no tiene datos", () => {
    const a = advertencias({ anio: 2026, mes: 1 }, { anio: 2025, mes: 12 }, periodos);
    expect(a).toContain("Diciembre 2025 no tiene datos en esta versión: la comparación es contra cero.");
  });
});

describe("queryString", () => {
  it("serializa solo lo que no es default y en orden estable", () => {
    expect(queryString({ periodo: { anio: 2026, mes: 9 }, comparar: "anterior", filtros: { art_codigo: "1201", canal: "Detalle" } }))
      .toBe("periodo=2026-09&canal=Detalle&producto=1201");
    expect(queryString({ periodo: { anio: 2026, mes: 9 }, comparar: "anio", filtros: {} })).toBe("periodo=2026-09&comparar=anio");
  });
});
