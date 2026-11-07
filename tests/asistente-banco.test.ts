/**
 * Banco de preguntas de prueba (G4) contra la versión publicada en el Supabase local, en modo determinista.
 * Se salta si no hay service_role (CI sin base). Detalle y criterio de cada pregunta en docs/banco-preguntas.md.
 */
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { responder } from "@/lib/asistente/responder";
import type { Contexto } from "@/lib/asistente/tipos";
import { leerParams } from "@/lib/dashboard/params";
import { crearConsultas, type Rpc } from "@/lib/semantic/consultas";
import type { VersionVigente } from "@/lib/semantic/contracts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;

type Caso = { pregunta: string; espera: (r: Awaited<ReturnType<typeof responder>>) => void };
const BANCO: Caso[] = [
  { pregunta: "¿Dónde se concentra la caída de septiembre?", espera: (r) => {
    expect(r.texto).toMatch(/cayó 6.9% vs. agosto 2026/);
    expect(r.texto).toContain("por canal en Mayoreo");
    expect(r.consultas.map((c) => c.herramienta)).toEqual(["kpi_periodo", "descomposicion", "variacion_por_dimension", "top_rutas", "variacion_por_dimension"]);
  } },
  { pregunta: "¿Por qué cayó la venta neta vs. agosto?", espera: (r) => {
    expect(r.hipotesis.length).toBeGreaterThan(0);
    expect(r.hechos.join(" ")).toMatch(/ticket por factura −6.2%/);
  } },
  { pregunta: "¿Qué rutas explican la caída?", espera: (r) => expect(r.consultas.map((c) => c.herramienta)).toContain("top_rutas") },
  { pregunta: "¿Cómo le fue a la marca ORO en septiembre?", espera: (r) => expect(r.evidencia.filtros).toBe("marca ORO") },
  { pregunta: "Variación por canal en septiembre vs. el año anterior", espera: (r) => expect(r.evidencia.periodo).toBe("septiembre 2026 vs. septiembre 2025") },
  { pregunta: "¿Cuánto vendimos en agosto 2026?", espera: (r) => {
    expect(r.texto).toContain("L 150.5 M");
    expect(r.consultas.map((c) => c.herramienta)).toEqual(["kpi_periodo"]);
  } },
  { pregunta: "Evolución mensual de 2025", espera: (r) => {
    expect(r.visuales[0]).toMatchObject({ tipo: "serie", anio: 2025 });
    expect(r.evidencia.periodo).toBe("año 2025 vs. 2024");
  } },
  { pregunta: "¿Qué productos cayeron más en Mayoreo?", espera: (r) => {
    expect(r.evidencia.filtros).toBe("canal Mayoreo");
    expect(r.consultas.find((c) => c.herramienta === "variacion_por_dimension")?.argumentos.dimension).toBe("art_codigo");
  } },
  { pregunta: "¿Bajó el número de facturas o el ticket?", espera: (r) => expect(r.consultas.map((c) => c.herramienta)).toContain("descomposicion") },
  { pregunta: "Variación por zona", espera: (r) => expect(r.texto).toMatch(/por zona en ZC/) },
  { pregunta: "¿Cuál es nuestro market share en café?", espera: bloqueada },
  { pregunta: "¿Cuánto vamos a vender en noviembre?", espera: bloqueada },
  { pregunta: "¿Cuántas visitas hicimos en la ruta 127?", espera: bloqueada },
  { pregunta: "¿Cuántos pedidos hubo en septiembre?", espera: bloqueada },
  { pregunta: "¿Qué clientes dejaron de comprar?", espera: bloqueada },
];

function bloqueada(r: Awaited<ReturnType<typeof responder>>) {
  expect(r.estado).toBe("fuera_de_alcance");
  expect(r.consultas).toEqual([]);
  expect(r.texto).not.toMatch(/L \d/);
}

describe.skipIf(!url || !key)("banco de preguntas (Supabase local)", () => {
  let ctx: Contexto;
  beforeAll(async () => {
    const sb = createClient(url!, key!, { auth: { persistSession: false } });
    const rpc: Rpc = async (fn, args, schema) => {
      const { data, error } = await sb.schema("ventas").rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return schema.parse(data);
    };
    const fuente = crearConsultas(rpc);
    const version = (await fuente.versionVigente()) as VersionVigente;
    // Contexto como si viniera de "Preguntar al asistente" en el dashboard en septiembre 2026: fijo, para que el
    // banco no cambie cuando se publica un mes nuevo (las expectativas son sobre septiembre vs. agosto).
    ctx = { fuente, version, estado: leerParams({ periodo: "2026-09" }, version.metadatos.periodos) };
  });

  it("tiene 15 preguntas, 5 fuera de alcance", () => {
    expect(BANCO).toHaveLength(15);
    expect(BANCO.filter((c) => c.espera === bloqueada)).toHaveLength(5);
  });

  for (const caso of BANCO) {
    it(caso.pregunta, async () => {
      const r = await responder(caso.pregunta, [], ctx, null);
      caso.espera(r);
      if (r.estado === "ok") {
        expect(r.evidencia.version).toBe(ctx.version.version);
        expect(r.evidencia.calculo.length).toBeGreaterThan(0);
        expect(r.hipotesis.join(" ")).not.toMatch(/\d/);
        expect(JSON.stringify(r)).not.toMatch(/cliente_(codigo|nombre)|subgrupo/);
      }
    }, 30_000);
  }
});
