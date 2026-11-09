/** Lectura del reporte de BI (V1-06, S28): encabezados, meses, números y errores con su fila, sin corregir nada. */
import { describe, expect, it } from "vitest";
import { alertaControl, leerControl, numeroControl, tablaCsv, type ControlBi, type ResultadoControl } from "@/lib/cargas/control-bi";

describe("control de BI", () => {
  it("encuentra los encabezados bajo un título, por nombre y sin importar tildes ni orden", () => {
    const l = leerControl([
      ["Reporte de cierre BI"],
      [],
      ["Canal BIA", "AÑO", "Mes Nom", "Venta Neta", "KG"],
      ["Detalle", 2026, "Octubre", 1500.5, 20],
      ["Mayoreo", "2026", "oct", "1,234,567.89", "(3.5)"],
      ["Total", "", "", 1236068.39, 16.5],
    ]);
    expect(l).toEqual({
      nivel: ["canal"], medidas: ["venta_neta", "kg"],
      filas: [
        { anio: 2026, mes: 10, empresa: null, canal: "Detalle", venta_neta: 1500.5, kg: 20 },
        { anio: 2026, mes: 10, empresa: null, canal: "Mayoreo", venta_neta: 1234567.89, kg: -3.5 },
      ],
    });
  });

  it("acepta solo kg y total por mes", () => {
    expect(leerControl([["Año", "Mes", "Kilos"], [2026, 9, 12.25]])).toEqual({ nivel: [], medidas: ["kg"], filas: [{ anio: 2026, mes: 9, empresa: null, canal: null, venta_neta: null, kg: 12.25 }] });
  });

  it("rechaza con la fila: coma decimal, mes inválido, clave repetida, falta de medida o de columnas", () => {
    const cab = ["Año", "Mes", "Canal", "Venta Neta"];
    expect(leerControl([cab, [2026, 10, "Detalle", "1.234,56"]])).toEqual({ error: expect.stringMatching(/^Fila 2: venta neta no es un número/) });
    expect(leerControl([cab, [2026, 13, "Detalle", 1]])).toEqual({ error: expect.stringMatching(/^Fila 2: mes inválido/) });
    expect(leerControl([cab, [2026, 10, "Detalle", 1], [2026, 10, "DETALLE", 2]])).toEqual({ error: expect.stringMatching(/^Fila 3: .*aparece dos veces/) });
    expect(leerControl([cab, [2026, 10, "", 1]])).toEqual({ error: "Fila 2: falta el canal." });
    expect(leerControl([["Año", "Mes", "Canal"], [2026, 10, "Detalle"]])).toEqual({ error: expect.stringMatching(/Venta Neta» o «Kg/) });
    expect(leerControl([["Periodo", "Venta"], ["2026-10", 1]])).toEqual({ error: expect.stringMatching(/No se encontraron las columnas/) });
  });

  it("números: punto decimal, comas de miles, paréntesis y Lempiras", () => {
    expect([numeroControl("L 1,000.25"), numeroControl("-12"), numeroControl("(7)"), numeroControl(""), numeroControl("1.234,5"), numeroControl({ result: 3 })])
      .toEqual([1000.25, -12, -7, null, NaN, 3]);
  });

  it("CSV con punto y coma o coma, y comillas", () => {
    expect(tablaCsv("﻿Año;Mes;Venta Neta\r\n2026;10;1500.5")).toEqual([["Año", "Mes", "Venta Neta"], ["2026", "10", "1500.5"]]);
    expect(tablaCsv('Año,Mes,Canal,Venta Neta\n2026,10,"Detalle, Norte","1,000.00"')[1]).toEqual(["2026", "10", "Detalle, Norte", "1,000.00"]);
  });

  it("la alerta dice si falta, si no coincide (con los meses sin cubrir) o si coincide", () => {
    const r = (o: Partial<ResultadoControl>): ControlBi => ({ resultado: { cifras: 6, iguales: 6, coincide: true, total_diferencias: 0, meses: [], diferencias: [], ...o } } as unknown as ControlBi);
    expect(alertaControl(undefined)).toMatchObject({ nivel: "revisar", texto: expect.stringMatching(/^Sin control de BI/) });
    expect(alertaControl(r({}))).toMatchObject({ nivel: "info", texto: expect.stringMatching(/coincide: 6 cifras iguales/) });
    expect(alertaControl(r({ coincide: false, iguales: 5, total_diferencias: 1, meses: [{ anio: 2026, mes: 10, en_foresight: true, en_bi: false }] })))
      .toMatchObject({ nivel: "revisar", texto: expect.stringMatching(/1 de 6 cifras distintas; el control no trae octubre 2026/) });
  });
});
