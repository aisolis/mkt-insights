/**
 * Alertas antes de publicar (G7): compara lo que trae el archivo, mes por mes, con la versión vigente.
 * "bloqueo" impide publicar; "revisar" exige que quien publica confirme que lo revisó; "info" solo informa.
 * Umbrales (S18): reemplazo con cambio > 1% en venta neta o filas; mes nuevo con variación > 30% contra el anterior;
 * duplicados > 2% de las filas; el último mes es parcial si llega a menos de 2 días del fin de mes.
 */
import { conteo, fechaCorta, lempirasCompacto, periodoLargo } from "@/lib/format";
import type { Alerta, Mes } from "./tipos";

const clave = (m: { anio: number; mes: number }) => m.anio * 12 + (m.mes - 1);
const desdeClave = (k: number) => ({ anio: Math.floor(k / 12), mes: (k % 12) + 1 });
const ultimoDiaDelMes = (m: { anio: number; mes: number }) => new Date(Date.UTC(m.anio, m.mes, 0)).getUTCDate();
const pct = (actual: number, anterior: number) => (anterior === 0 ? null : ((actual - anterior) / Math.abs(anterior)) * 100);
const pctTxt = (p: number | null) => (p === null ? "sin base" : `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`);

export function esParcial(m: Mes) {
  return Number(m.ultimo_dia.slice(8, 10)) < ultimoDiaDelMes(m) - 2;
}

export function alertasCarga(carga: Mes[], vigente: Mes[], hoy: string): Alerta[] {
  const a: Alerta[] = [];
  if (!carga.length) return [{ nivel: "bloqueo", texto: "La carga no tiene filas." }];
  const nuevos = [...carga].sort((x, y) => clave(x) - clave(y));
  const porClave = new Map(vigente.map((m) => [clave(m), m]));
  const compuesto = new Map([...porClave, ...nuevos.map((m) => [clave(m), m] as const)]);

  const futuro = nuevos.filter((m) => m.ultimo_dia > hoy);
  if (futuro.length) a.push({ nivel: "bloqueo", texto: `Hay ventas con fecha futura (hasta ${fechaCorta(futuro.at(-1)!.ultimo_dia)}). Revisa la exportación.` });

  const nuevasClaves = new Set(nuevos.map(clave));
  if (vigente.length > 1 && vigente.every((m) => nuevasClaves.has(clave(m))))
    a.push({ nivel: "info", texto: `El archivo reemplaza toda la historia publicada (${nuevos.length} meses).` });

  const ultimoVigente = vigente.length ? Math.max(...vigente.map(clave)) : null;
  const primeroNuevo = clave(nuevos[0]);
  if (ultimoVigente !== null && primeroNuevo > ultimoVigente + 1) {
    const faltan = Array.from({ length: primeroNuevo - ultimoVigente - 1 }, (_, i) => periodoLargo(desdeClave(ultimoVigente + 1 + i)));
    a.push({ nivel: "revisar", texto: `Faltan meses entre lo publicado y este archivo: ${faltan.join(", ")}.` });
  }

  for (const m of nuevos) {
    const nombre = periodoLargo(m);
    const antes = porClave.get(clave(m));
    if (antes) {
      const dv = pct(m.venta_neta, antes.venta_neta), df = pct(m.filas, antes.filas);
      const cambio = `venta neta ${lempirasCompacto(antes.venta_neta)} → ${lempirasCompacto(m.venta_neta)} (${pctTxt(dv)}), filas ${conteo(antes.filas)} → ${conteo(m.filas)}`;
      if (Math.abs(dv ?? 100) > 1 || Math.abs(df ?? 100) > 1) a.push({ nivel: "revisar", texto: `Reemplaza ${nombre}: ${cambio}.` });
      else a.push({ nivel: "info", texto: `Reemplaza ${nombre} sin cambios relevantes (${pctTxt(dv)} en venta neta).` });
      if (m.ultimo_dia < antes.ultimo_dia)
        a.push({ nivel: "revisar", texto: `${nombre} llega hasta el ${fechaCorta(m.ultimo_dia)}, pero lo publicado llegaba hasta el ${fechaCorta(antes.ultimo_dia)}: se perderían días.` });
    } else {
      const previo = compuesto.get(clave(m) - 1);
      const dv = previo ? pct(m.venta_neta, previo.venta_neta) : null;
      if (previo && Math.abs(dv ?? 0) > 30)
        a.push({ nivel: "revisar", texto: `${nombre} es nuevo y cambia ${pctTxt(dv)} contra ${periodoLargo(previo)} (${lempirasCompacto(m.venta_neta)} contra ${lempirasCompacto(previo.venta_neta)}). Confirma que el archivo esté completo.` });
      else a.push({ nivel: "info", texto: `${nombre} es nuevo: ${lempirasCompacto(m.venta_neta)} en ${conteo(m.filas)} filas${previo ? ` (${pctTxt(dv)} contra ${periodoLargo(previo)})` : ""}.` });
    }
    if (m.canales_sin_homologar.length)
      a.push({ nivel: "revisar", texto: `${nombre}: canales sin homologar (${m.canales_sin_homologar.join(", ")}); se mostrarán con su nombre de origen.` });
    if (m.duplicados > m.filas * 0.02)
      a.push({ nivel: "revisar", texto: `${nombre}: ${conteo(m.duplicados)} filas repetidas (${((m.duplicados / m.filas) * 100).toFixed(1)}%). Se conservan y se marcan (S3).` });
    if (m.discrepancias)
      a.push({ nivel: "info", texto: `${nombre}: ${conteo(m.discrepancias)} filas donde bruta − descuentos ≠ neta; se usa la venta neta del archivo (S3).` });
  }

  const ultimo = nuevos.at(-1)!;
  if (ultimoVigente === null || clave(ultimo) >= ultimoVigente) {
    a.push(esParcial(ultimo)
      ? { nivel: "info", texto: `${periodoLargo(ultimo)} llega hasta el ${fechaCorta(ultimo.ultimo_dia)}: se publicará como mes parcial.` }
      : { nivel: "info", texto: `${periodoLargo(ultimo)} llega hasta el ${fechaCorta(ultimo.ultimo_dia)}: se publicará como mes completo salvo que indiques lo contrario.` });
  }
  const orden = { bloqueo: 0, revisar: 1, info: 2 };
  return a.sort((x, y) => orden[x.nivel] - orden[y.nivel]);
}
