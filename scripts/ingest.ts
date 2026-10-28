/**
 * Ingesta local del XLSX del cubo → ventas.hecho (G2).
 * Uso: npx tsx scripts/ingest.ts [ruta.xlsx]
 * Requiere SUPABASE_SERVICE_ROLE_KEY. Lee en streaming (ExcelJS), normaliza y sube en lotes.
 * Reglas (SUPUESTOS.md): S2 homologación, S3 flags sin corregir, S9 serial Excel → fecha, códigos a texto.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const XLSX = process.argv[2] ?? process.env.XLSX_PATH!;
const BATCH = 2000;
const HOJAS_HECHOS = (name: string) => name !== "Desgloce";
const COLS = ["Fecha","Ruta","Empresa","Marca","Café/Rep","Proveedor","Cliente Codigo","Cliente Nombre","Zona","Documento","Año","Mes Nom","Grupo","Canal BIA","ArtCodigo","ArtDescrip","Cantidad","Venta Bruta","Descuentos","Venta Neta","Kg","Fardos/Caja","Subgrupo","Sucursal"] as const;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function sha256(path: string) {
  return new Promise<string>((res, rej) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej);
  });
}
const txt = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" && "text" in (v as object) ? String((v as { text: string }).text) : String(v)).trim();
const codigo = (v: unknown) => (typeof v === "number" ? String(Math.trunc(v)) : txt(v));
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(txt(v).replace(/,/g, "")); if (Number.isNaN(n)) throw new Error(`numérico inválido: ${v}`); return n; };
function fecha(v: unknown): { d: Date; serial: boolean } {
  if (v instanceof Date) return { d: v, serial: false };
  const n = Number(v);
  if (!Number.isNaN(n)) return { d: new Date(Date.UTC(1899, 11, 30) + n * 86400000), serial: true }; // S9
  throw new Error(`fecha inválida: ${v}`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function cargarHomologacion() {
  const { data, error } = await sb.schema("ventas").from("homologacion").select("valor_origen,valor_homologado").eq("dimension", "canal");
  if (error) throw error;
  return new Map(data.map((r) => [r.valor_origen, r.valor_homologado]));
}

async function main() {
  const hash = await sha256(XLSX);
  const bytes = statSync(XLSX).size;
  console.log("archivo", XLSX, bytes, "bytes", hash);

  const { data: existente } = await sb.schema("ventas").from("carga").select("id,estado").eq("sha256", hash).maybeSingle();
  if (existente) { console.log("ya cargado:", existente); return; } // idempotencia por hash (AT07)

  const { data: carga, error: e1 } = await sb.schema("ventas").from("carga")
    .insert({ nombre_archivo: XLSX.split(/[\\/]/).pop(), sha256: hash, bytes, estado: "procesando" }).select().single();
  if (e1) throw e1;

  const homol = await cargarHomologacion();
  const vistos = new Set<string>();
  let leidas = 0, vacias = 0, cargadas = 0, dup = 0, disc = 0, serial = 0;
  let minF = "9999-12-31", maxF = "0000-01-01";
  let lote: Record<string, unknown>[] = [];

  const flush = async () => {
    if (!lote.length) return;
    const { error } = await sb.schema("ventas").from("hecho").insert(lote);
    if (error) throw error;
    cargadas += lote.length; lote = [];
    if (cargadas % 50000 === 0) console.log("cargadas", cargadas);
  };

  const wb = new ExcelJS.stream.xlsx.WorkbookReader(XLSX, { entries: "emit", sharedStrings: "cache", styles: "cache", worksheets: "emit" }); // sin styles: "cache" toda fecha llega como número y S9 marcaría todas las filas
  for await (const ws of wb) {
    // @ts-expect-error name existe en el reader de streaming
    const hoja: string = ws.name;
    if (!HOJAS_HECHOS(hoja)) continue;
    let header: string[] = [];
    for await (const row of ws) {
      const vals = (row.values as unknown[]).slice(1);
      if (row.number === 1) { header = vals.map(txt); COLS.forEach((c, i) => { if (header[i] !== c) throw new Error(`${hoja}: columna ${i + 1} esperada "${c}", vino "${header[i]}"`); }); continue; }
      leidas++;
      if (vals.every((v) => v === null || v === undefined || txt(v) === "")) { vacias++; continue; }
      const r = Object.fromEntries(COLS.map((c, i) => [c, vals[i]])) as Record<(typeof COLS)[number], unknown>;
      const f = fecha(r["Fecha"]); if (f.serial) serial++;
      const d = iso(f.d); if (d < minF) minF = d; if (d > maxF) maxF = d;
      const bruta = num(r["Venta Bruta"]), desc = num(r["Descuentos"]), neta = num(r["Venta Neta"]);
      const flagDisc = Math.abs(bruta - desc - neta) > 0.01; if (flagDisc) disc++;
      const canalOrigen = txt(r["Canal BIA"]);
      const fila = {
        carga_id: carga.id, hoja, fila_origen: row.number,
        fecha: d, anio: f.d.getUTCFullYear(), mes: f.d.getUTCMonth() + 1,
        ruta: codigo(r["Ruta"]), empresa: txt(r["Empresa"]), marca: txt(r["Marca"]), categoria: txt(r["Café/Rep"]), proveedor: txt(r["Proveedor"]),
        cliente_codigo: codigo(r["Cliente Codigo"]), cliente_nombre: txt(r["Cliente Nombre"]), zona: txt(r["Zona"]), documento: codigo(r["Documento"]),
        grupo: txt(r["Grupo"]), canal_origen: canalOrigen, canal: homol.get(canalOrigen) ?? canalOrigen,
        art_codigo: codigo(r["ArtCodigo"]), art_descrip: txt(r["ArtDescrip"]),
        cantidad: num(r["Cantidad"]), venta_bruta: bruta, descuentos: desc, venta_neta: neta, kg: num(r["Kg"]), fardos_caja: r["Fardos/Caja"] == null ? null : num(r["Fardos/Caja"]),
        subgrupo: txt(r["Subgrupo"]), sucursal: txt(r["Sucursal"]),
        flag_discrepancia: flagDisc, flag_fecha_serial: f.serial, flag_duplicado: false,
      };
      const key = JSON.stringify([fila.fecha, fila.ruta, fila.empresa, fila.marca, fila.categoria, fila.proveedor, fila.cliente_codigo, fila.cliente_nombre, fila.zona, fila.documento, fila.grupo, fila.canal_origen, fila.art_codigo, fila.art_descrip, fila.cantidad, bruta, desc, neta, fila.kg, fila.fardos_caja, fila.subgrupo, fila.sucursal]);
      if (vistos.has(key)) { fila.flag_duplicado = true; dup++; } else vistos.add(key); // S3: se conserva y se marca
      lote.push(fila);
      if (lote.length >= BATCH) await flush();
    }
  }
  await flush();
  await sb.schema("ventas").from("carga").update({ estado: "validada", filas_leidas: leidas, filas_vacias: vacias, filas_cargadas: cargadas, periodo_desde: minF, periodo_hasta: maxF }).eq("id", carga.id);
  console.log({ leidas, vacias, cargadas, duplicados: dup, discrepancias: disc, fechas_serial: serial, minF, maxF });
  console.log("Control esperado (analisis/perfil.json): 1073421 cargadas · 5744 duplicados · 153 discrepancias · 23994 seriales");
}

main().catch((e) => { console.error(e); process.exit(1); });
