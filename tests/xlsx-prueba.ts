/**
 * Excel con el formato del cubo y datos ficticios (ruta, clientes y documentos de prueba) para probar la carga
 * mensual sin tocar archivos reales.
 */
import ExcelJS from "exceljs";
import { COLS } from "@/lib/cargas/ingesta";

export type FilaPrueba = { fecha: Date; canal: string; ventaNeta: number; kg?: number; duplicar?: boolean };

/** `resumen`: agrega antes una hoja con otro formato (como los resúmenes que vienen junto a la exportación). */
export async function xlsxDePrueba(filas: FilaPrueba[], columnas: readonly string[] = COLS, resumen = false): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  if (resumen) {
    const r = libro.addWorksheet("1. Resumen por canal");
    r.addRow(["Año", "Canal BIA", "Kilos", "Venta_Neta"]);
    r.addRow([2026, "Mayoreo", 10, 1000]);
  }
  const hoja = libro.addWorksheet("Hoja1");
  hoja.addRow([...columnas]);
  filas.forEach((f, i) => {
    const valores: Record<string, unknown> = {
      "Fecha": f.fecha, "Ruta": "999 - RUTA DE PRUEBA", "Empresa": "MCM", "Marca": "MARCA PRUEBA", "Café/Rep": "Café", "Proveedor": "PRUEBA",
      "Cliente Codigo": 900000 + (i % 50), "Cliente Nombre": `CLIENTE FICTICIO ${i % 50}`, "Zona": "ZONA PRUEBA", "Documento": 7000000 + i,
      "Año": f.fecha.getUTCFullYear(), "Mes Nom": "", "Grupo": "PRUEBA", "Canal BIA": f.canal, "ArtCodigo": "PRUEBA-1", "ArtDescrip": "PRODUCTO DE PRUEBA",
      "Cantidad": 1, "Venta Bruta": f.ventaNeta, "Descuentos": 0, "Venta Neta": f.ventaNeta, "Kg": f.kg ?? 1, "Fardos/Caja": null,
      "Subgrupo": "PRUEBA", "Sucursal": "SUCURSAL PRUEBA",
    };
    const fila = columnas.map((c) => valores[c] ?? null);
    hoja.addRow(fila);
    if (f.duplicar) hoja.addRow(fila);
  });
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** Días de un mes (UTC) con ventas. */
export const dias = (anio: number, mes: number, hasta: number) => Array.from({ length: hasta }, (_, i) => new Date(Date.UTC(anio, mes - 1, i + 1)));
