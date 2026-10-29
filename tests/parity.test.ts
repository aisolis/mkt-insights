/**
 * Paridad G2: totales por mes en Supabase == analisis/totales_por_mes.csv (perfil independiente en pandas).
 * Requiere PARITY_DIR y credenciales (PARITY_CARGA_ID opcional; por defecto la última carga validada o publicada). Se omite si faltan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const dir = process.env.PARITY_DIR;
const skip = !dir || !process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(skip)("paridad mensual contra perfil pandas", () => {
  it("coincide en filas, venta neta (centavos) y kg (4 decimales)", async () => {
    const csv = readFileSync(join(dir!, "totales_por_mes.csv"), "utf8").trim().split("\n").slice(1)
      .map((l) => { const [mes, filas, venta_neta, kg] = l.split(","); return { mes, filas: +filas, venta_neta: +venta_neta, kg: +kg }; });
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    // Sin PARITY_CARGA_ID se verifica la última carga validada o publicada.
    let cargaId = process.env.PARITY_CARGA_ID;
    if (!cargaId) {
      const { data: c, error: ec } = await sb.schema("ventas").from("carga").select("id").in("estado", ["validada", "publicada"]).order("creado_en", { ascending: false }).limit(1).single();
      expect(ec).toBeNull();
      cargaId = c!.id as string;
    }
    const { data, error } = await sb.schema("ventas").rpc("control_mensual", { p_carga: cargaId });
    expect(error).toBeNull();
    const db = new Map((data as { mes: string; filas: number; venta_neta: string; kg: string }[]).map((r) => [r.mes, r]));
    expect(db.size).toBe(csv.length);
    for (const e of csv) {
      const r = db.get(e.mes)!;
      expect(r, e.mes).toBeDefined();
      expect(Number(r.filas)).toBe(e.filas);
      expect(Math.round(Number(r.venta_neta) * 100)).toBe(Math.round(e.venta_neta * 100));
      expect(Number(r.kg)).toBeCloseTo(e.kg, 4);
    }
  });
});
