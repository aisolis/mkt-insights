/**
 * Alertas antes de publicar (G7): compara lo que trae el archivo, mes por mes, con la versión vigente.
 * "bloqueo" impide publicar; "revisar" exige que quien publica confirme que lo revisó; "info" solo informa.
 * Umbrales (S18): reemplazo con cambio > 1% en venta neta o filas; mes nuevo con variación > 30% contra el anterior;
 * duplicados > 2% de las filas; el último mes es parcial si llega a menos de 2 días del fin de mes.
 * Por canal (S20, G9): ver UMBRAL_CANAL y alertasCanal.
 */
import { capital, conteo, fechaCorta, lempirasCompacto, periodoLargo } from "@/lib/format";
import type { Alerta, CanalMes, Mes } from "./tipos";

const clave = (m: { anio: number; mes: number }) => m.anio * 12 + (m.mes - 1);
const desdeClave = (k: number) => ({ anio: Math.floor(k / 12), mes: (k % 12) + 1 });
const ultimoDiaDelMes = (m: { anio: number; mes: number }) => new Date(Date.UTC(m.anio, m.mes, 0)).getUTCDate();
const pct = (actual: number, anterior: number) => (anterior === 0 ? null : ((actual - anterior) / Math.abs(anterior)) * 100);
const pctTxt = (p: number | null) => (p === null ? "sin base" : `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`);

export function esParcial(m: Mes) {
  return Number(m.ultimo_dia.slice(8, 10)) < ultimoDiaDelMes(m) - 2;
}

/** Venta neta por canal de la carga y de la versión vigente; sin esto no hay alertas por canal. */
export type CanalesAlertas = { carga: CanalMes[]; vigente: CanalMes[] };

/** camposVacios: columnas opcionales que el archivo no trae y se cargaron vacías (S26), ya en palabras. */
export function alertasCarga(carga: Mes[], vigente: Mes[], hoy: string, hojasIgnoradas: string[] = [], canales?: CanalesAlertas, camposVacios: string[] = []): Alerta[] {
  const a: Alerta[] = [];
  if (!carga.length) return [{ nivel: "bloqueo", texto: "La carga no tiene filas." }];
  if (hojasIgnoradas.length)
    a.push({ nivel: "revisar", texto: `No se cargaron hojas sin las columnas configuradas: ${hojasIgnoradas.map((h) => `«${h}»`).join(", ")}. Si alguna tenía ventas línea por línea, revisa sus encabezados en Columnas del Excel.` });
  if (camposVacios.length)
    a.push({ nivel: "revisar", texto: `El archivo no trae ${camposVacios.join(", ")}: se cargaron vacías. Si BIA las sigue usando, revisa la exportación o agrega el nombre de la columna en Columnas del Excel.` });
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
      // Si lo publicado era un mes parcial, el salto es esperable: se dice para que no asuste.
      const completa = m.ultimo_dia > antes.ultimo_dia ? ` Lo publicado llegaba solo hasta el ${fechaCorta(antes.ultimo_dia)}; este archivo completa el mes.` : "";
      if (Math.abs(dv ?? 100) > 1 || Math.abs(df ?? 100) > 1) a.push({ nivel: "revisar", texto: `Reemplaza ${nombre}: ${cambio}.${completa}` });
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
    if (canales) a.push(...alertasCanal(m, antes, porClave, canales));
    if (m.canales_sin_homologar.length)
      a.push({ nivel: "revisar", texto: `${nombre}: canales sin homologar (${m.canales_sin_homologar.join(", ")}); se mostrarán con su nombre de origen.` });
    if (m.duplicados > m.filas * 0.02)
      a.push({ nivel: "revisar", texto: `${nombre}: ${conteo(m.duplicados)} filas repetidas (${((m.duplicados / m.filas) * 100).toFixed(1)}%). Se conservan y quedan marcadas.` });
    if (m.discrepancias)
      a.push({ nivel: "info", texto: `${nombre}: ${conteo(m.discrepancias)} filas donde bruta − descuentos ≠ neta; se usa la venta neta del archivo.` });
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

/**
 * S20: umbrales de las alertas por canal (canal BIA ya homologado; los canales sin homologar cuentan con su nombre
 * de origen). Comparan solo meses con los mismos días para no confundir un mes parcial con una caída.
 */
export const UMBRAL_CANAL = {
  /** Mes que reemplaza uno publicado con el mismo último día: cambio por canal mayor a este % frente a lo publicado. */
  reemplazo: 5,
  /** Mes nuevo y completo: cambio por canal mayor a este % frente al promedio de los 3 meses anteriores publicados y completos. */
  promedio: 25,
  /** Canales chicos: se ignoran si pesan menos de este % de la venta neta del mes, en el archivo y en la referencia. */
  pesoMinimo: 3,
} as const;

const pctEntero = (p: number) => `${Math.round(Math.abs(p))} %`;

/** "revisar" cuando un canal cambia bruscamente frente a lo publicado de ese mes o al promedio de los 3 meses anteriores. */
export function alertasCanal(m: Mes, antes: Mes | undefined, vigente: Map<number, Mes>, canales: CanalesAlertas): Alerta[] {
  const k = clave(m);
  const suma = (filas: CanalMes[], meses: number[]) => {
    const r = new Map<string, number>();
    for (const f of filas) if (meses.includes(clave(f))) r.set(f.canal, (r.get(f.canal) ?? 0) + Number(f.venta_neta));
    return r;
  };

  let referencia: Map<string, number>, totalRef: number, umbral: number;
  let frente: string, enRef: string, laRef: string;
  if (antes) {
    // Si cambian los días (mes que se completa o que pierde días) ya hay una alerta general: por canal no se compara.
    if (m.ultimo_dia !== antes.ultimo_dia) return [];
    referencia = suma(canales.vigente, [k]);
    totalRef = antes.venta_neta;
    umbral = UMBRAL_CANAL.reemplazo;
    [frente, enRef, laRef] = ["frente a lo publicado para ese mes", "en lo publicado para ese mes", "lo publicado para ese mes"];
  } else {
    // Un mes nuevo parcial todavía no es comparable con meses completos.
    if (esParcial(m)) return [];
    const previos = [k - 3, k - 2, k - 1].filter((p) => vigente.has(p) && !esParcial(vigente.get(p)!));
    if (!previos.length) return [];
    const n = previos.length;
    const suma3 = suma(canales.vigente, previos);
    referencia = new Map([...suma3].map(([c, v]) => [c, v / n]));
    totalRef = previos.reduce((s, p) => s + vigente.get(p)!.venta_neta, 0) / n;
    umbral = UMBRAL_CANAL.promedio;
    const nombres = previos.map((p) => periodoLargo(desdeClave(p)));
    if (n === 1) [frente, enRef, laRef] = [`frente a ${nombres[0]}`, `en ${nombres[0]}`, nombres[0]];
    else {
      const de = n === 3 ? `los 3 meses anteriores` : nombres.join(" y ");
      [frente, enRef, laRef] = [`frente al promedio de ${de}`, `en ${de}`, `el promedio de ${de}`];
    }
  }
  const actual = suma(canales.carga, [k]);
  const totalNuevo = m.venta_neta;
  if (totalNuevo <= 0 || totalRef <= 0) return [];

  const nombre = capital(periodoLargo(m));
  const salida: { cambio: number; alerta: Alerta }[] = [];
  for (const canal of new Set([...actual.keys(), ...referencia.keys()])) {
    const a = actual.get(canal) ?? 0, r = referencia.get(canal) ?? 0;
    if (Math.max((a / totalNuevo) * 100, (r / totalRef) * 100) < UMBRAL_CANAL.pesoMinimo) continue;
    let texto: string | null = null;
    if (r <= 0) texto = `${nombre}: aparece ${canal} con ${lempirasCompacto(a)} (${pctEntero((a / totalNuevo) * 100)} del mes), sin ventas ${enRef}.`;
    else if (a <= 0) texto = `${nombre}: ${canal} no tiene ventas; ${laRef} era ${lempirasCompacto(r)}.`;
    else {
      const p = ((a - r) / r) * 100;
      if (Math.abs(p) > umbral) texto = `${nombre}: ${canal} ${p > 0 ? "sube" : "baja"} ${pctEntero(p)} ${frente} (${lempirasCompacto(a)} contra ${lempirasCompacto(r)}).`;
    }
    if (texto) salida.push({ cambio: Math.abs(a - r), alerta: { nivel: "revisar", texto } });
  }
  return salida.sort((x, y) => y.cambio - x.cambio).map((x) => x.alerta);
}
