import { registrarEvento } from "@/lib/auditoria";
import { accesoApi } from "@/lib/auth/acceso";
import { leerParams, periodoComparado } from "@/lib/dashboard/params";
import { topContribuyentes, versionVigente } from "@/lib/semantic/queries";

/**
 * Exporta "Rutas que más contribuyen a la variación" con los filtros del dashboard (misma URL),
 * todas las combinaciones ruta × canal y cifras exactas. Cada fila lleva versión y corte para trazabilidad.
 */
export async function GET(request: Request) {
  const usuario = await accesoApi();
  if (usuario instanceof Response) return usuario;
  const version = await versionVigente();
  if (!version) return new Response("Sin versión publicada", { status: 404 });

  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const estado = leerParams(sp, version.metadatos.periodos);
  const cmp = periodoComparado(estado.periodo, estado.comparar);
  const filas = await topContribuyentes({ version: version.version, periodo: estado.periodo, comparar: cmp, filtros: estado.filtros, limite: 5000 });

  const p = (x: { anio: number; mes: number }) => `${x.anio}-${String(x.mes).padStart(2, "0")}`;
  const filtros = Object.entries(estado.filtros).map(([k, v]) => `${k}=${v}`).join("; ");
  const cab = ["ruta", "canal", "periodo", "periodo_comparado", "venta_neta", "venta_neta_comparado", "variacion", "filtros", "version", "fecha_corte", "conciliada_bi"];
  const lineas = filas.map((f) => [f.ruta, f.canal, p(estado.periodo), p(cmp), f.actual.toFixed(2), f.anterior.toFixed(2), f.variacion.toFixed(2),
    filtros, `v${version.version}`, version.fecha_corte, version.conciliada_bi ? "si" : "no"].map(csv).join(","));

  const nombre = `rutas-variacion-${p(estado.periodo)}-vs-${p(cmp)}-v${version.version}.csv`;
  await registrarEvento(usuario.id, "exportacion", { que: "rutas que más contribuyen (CSV)", periodo: p(estado.periodo), comparado: p(cmp), filtros, version: version.version, filas: filas.length });
  // BOM para que Excel abra el UTF-8 con tildes correctamente.
  return new Response("﻿" + [cab.join(","), ...lineas].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nombre}"` },
  });
}

const csv = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
