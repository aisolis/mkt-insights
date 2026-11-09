import { registrarEvento } from "@/lib/auditoria";
import { accesoApiPlus } from "@/lib/auth/acceso";
import { leerParams, periodoComparado } from "@/lib/dashboard/params";
import { consultasClientesSesion, ESTADOS_CLIENTE, leerEstadoCliente } from "@/lib/semantic/clientes";
import { versionVigente } from "@/lib/semantic/queries";

/**
 * Exporta la lista de clientes de un estado (?ver=perdidos) con los filtros del dashboard (misma URL), todos los
 * clientes y cifras exactas. Solo Plus (aquí y en la base). Cada fila lleva versión y corte para trazabilidad.
 */
export async function GET(request: Request) {
  const usuario = await accesoApiPlus();
  if (usuario instanceof Response) return usuario;
  const version = await versionVigente();
  if (!version) return new Response("Sin versión publicada", { status: 404 });

  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const estado = leerParams(sp, version.metadatos.periodos);
  const cmp = periodoComparado(estado.periodo, estado.comparar);
  const ver = leerEstadoCliente(sp.ver);
  const { clientesLista } = await consultasClientesSesion();
  const lista = await clientesLista({ version: version.version, periodo: estado.periodo, comparar: cmp, filtros: estado.filtros, estado: ver, limite: 50000 });

  const p = (x: { anio: number; mes: number }) => `${x.anio}-${String(x.mes).padStart(2, "0")}`;
  const filtros = Object.entries(estado.filtros).map(([k, v]) => `${k}=${v}`).join("; ");
  const cab = ["estado", "empresa", "cliente_codigo", "cliente_nombre", "ruta_principal", "periodo", "periodo_comparado", "venta_neta",
    "venta_neta_comparado", "variacion", "ultima_compra", "en_riesgo", "filtros", "version", "fecha_corte", "conciliada_bi"];
  const titulo = ESTADOS_CLIENTE[ver].titulo.toLowerCase();
  const lineas = lista.filas.map((f) => [titulo, f.empresa, f.cliente_codigo, f.cliente_nombre ?? "", f.ruta, p(estado.periodo), p(cmp),
    f.venta.toFixed(2), f.venta_cmp.toFixed(2), f.variacion.toFixed(2), f.ultima_compra ?? "", f.en_riesgo ? "si" : "no",
    filtros, `v${version.version}`, version.fecha_corte, version.conciliada_bi ? "si" : "no"].map(csv).join(","));

  const nombre = `clientes-${ver.replace("_", "-")}-${p(estado.periodo)}-vs-${p(cmp)}-v${version.version}.csv`;
  // Qué se exportó, no a quién: los clientes no van a la bitácora.
  await registrarEvento(usuario.id, "exportacion", { que: `clientes ${titulo} (CSV, Plus)`, periodo: p(estado.periodo), comparado: p(cmp), filtros, version: version.version, filas: lista.filas.length });
  // BOM para que Excel abra el UTF-8 con tildes correctamente. Sin caché: es detalle por cliente.
  return new Response("﻿" + [cab.join(","), ...lineas].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nombre}"`, "Cache-Control": "private, no-store" },
  });
}

/** Comillas cuando hace falta y, como el CSV se abre en Excel, sin fórmulas: un nombre que empiece con = + - @ va con '. */
const csv = (v: string) => {
  // Solo las cifras completas (signo, dígitos y punto) se dejan sin ' para que Excel las lea como números.
  const s = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
