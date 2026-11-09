import { mesesSinCubrir, type ControlBi } from "@/lib/cargas/control-bi";
import { fechaCorta, fechaHoraLocal, lempiras } from "@/lib/format";
import { FormControl } from "./formularios";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const kgs = (n: number, d: number) => n.toLocaleString("es-HN", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Control de BI de una carga (V1-06): qué se comparó, si coincide y dónde difiere. Debajo, el formulario para subirlo o
 * reemplazarlo. La conciliación la pone la base al publicar (o al subirlo, si ya está publicada) solo si coincide todo.
 */
export function SeccionControl({ cargaId, control, titulo }: { cargaId: string; control?: ControlBi; titulo: string }) {
  const r = control?.resultado;
  const conVenta = control?.medidas.includes("venta_neta"), conKg = control?.medidas.includes("kg");
  const faltan = r ? mesesSinCubrir(r) : [];
  return (
    <section className="space-y-3 border-t border-neutral-200 pt-4" aria-labelledby={`control-${cargaId}`}>
      <div className="space-y-1">
        <h3 id={`control-${cargaId}`} className="text-sm font-semibold">{titulo}</h3>
        <p className="max-w-prose text-sm text-neutral-700">
          El reporte de BI del mes, generado fuera de Foresight, con venta neta y/o kg por mes (y, si BI quiere, por empresa y canal). Se compara cifra por
          cifra con esta carga; solo si todo coincide la versión queda «conciliada con BI».
        </p>
      </div>
      {control && r && (
        <div className="space-y-2 text-sm">
          <p className={r.coincide ? "text-emerald-800" : "text-amber-900"}>
            <span className="font-semibold">{r.coincide ? "Coincide" : "No coincide"}</span>
            {": "}{r.iguales.toLocaleString("es-HN")} de {r.cifras.toLocaleString("es-HN")} cifras iguales
            {control.nivel.length > 0 ? ` por mes, ${control.nivel.join(" y ")}` : " por mes"}
            {" · "}{[conVenta && "venta neta al centavo", conKg && `kg con ${control.decimales_kg} decimales`].filter(Boolean).join(", ")}
          </p>
          <p className="text-xs text-neutral-600">
            «{control.nombre_archivo}» de {control.custodio}, corte {fechaCorta(control.fecha_corte)} · subido por {control.subido_por ?? "alguien"} el {fechaHoraLocal(control.creado_en)}
            {control.nota && ` · ${control.nota}`}
          </p>
          {faltan.length > 0 && <p className="text-sm text-amber-900">Meses: {faltan.join("; ")}.</p>}
          {r.diferencias.length > 0 && (
            <div className="max-w-full overflow-x-auto">
              <table className="min-w-full border border-neutral-200 text-xs">
                <caption className="sr-only">Diferencias entre la carga y el control de BI</caption>
                <thead className="bg-neutral-50 text-left">
                  <tr>
                    <th scope="col" className="px-2 py-1 font-medium">Mes</th>
                    {control.nivel.includes("empresa") && <th scope="col" className="px-2 py-1 font-medium">Empresa</th>}
                    {control.nivel.includes("canal") && <th scope="col" className="px-2 py-1 font-medium">Canal</th>}
                    {conVenta && <><th scope="col" className="px-2 py-1 text-right font-medium">Venta neta Foresight</th><th scope="col" className="px-2 py-1 text-right font-medium">Venta neta BI</th><th scope="col" className="px-2 py-1 text-right font-medium">Diferencia</th></>}
                    {conKg && <><th scope="col" className="px-2 py-1 text-right font-medium">Kg Foresight</th><th scope="col" className="px-2 py-1 text-right font-medium">Kg BI</th></>}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {r.diferencias.map((d, i) => (
                    <tr key={i} className="border-t border-neutral-200">
                      <td className="px-2 py-1">{MESES[d.mes - 1]} {d.anio}</td>
                      {control.nivel.includes("empresa") && <td className="px-2 py-1">{d.empresa}</td>}
                      {control.nivel.includes("canal") && <td className="px-2 py-1">{d.canal}</td>}
                      {conVenta && <>
                        <td className="px-2 py-1 text-right">{lempiras(Number(d.venta_foresight))}</td>
                        <td className="px-2 py-1 text-right">{lempiras(Number(d.venta_bi))}</td>
                        <td className={`px-2 py-1 text-right ${Number(d.venta_foresight) !== Number(d.venta_bi) ? "font-medium text-red-700" : "text-neutral-400"}`}>
                          {lempiras(Number(d.venta_foresight) - Number(d.venta_bi))}
                        </td>
                      </>}
                      {conKg && <>
                        <td className={`px-2 py-1 text-right ${Number(d.kg_foresight) !== Number(d.kg_bi) ? "font-medium text-red-700" : ""}`}>{kgs(Number(d.kg_foresight), control.decimales_kg)}</td>
                        <td className="px-2 py-1 text-right">{kgs(Number(d.kg_bi), control.decimales_kg)}</td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.total_diferencias > r.diferencias.length && (
                <p className="mt-1 text-xs text-neutral-500">Se muestran las primeras {r.diferencias.length} de {r.total_diferencias} diferencias.</p>
              )}
            </div>
          )}
        </div>
      )}
      <FormControl cargaId={cargaId} reemplaza={!!control} />
    </section>
  );
}
