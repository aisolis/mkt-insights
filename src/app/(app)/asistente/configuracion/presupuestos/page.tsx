import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requerirAdmin } from "@/lib/auth/acceso";
import { usd } from "@/lib/asistente/dinero";
import { estadoPresupuesto, type FilaPresupuesto, type Solicitud } from "@/lib/asistente/presupuesto";
import { listarSolicitudes, presupuestoGeneral, presupuestosDelMes } from "@/lib/asistente/presupuesto-servidor";
import { fechaHora } from "../bitacora/textos";
import { FormGeneral, FormPersona, FormResolver } from "./formularios";

const MES = new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "UTC" });

const ORIGEN: Record<FilaPresupuesto["origen"], string> = { general: "general", propio: "propio", sin_limite: "sin límite" };

/** Presupuesto de IA por persona: el general, los propios, el gasto del mes y las solicitudes de ampliación. */
export default async function PresupuestosIa() {
  await requerirAdmin(); // el layout no se vuelve a ejecutar en cada navegación
  const [general, filas, solicitudes] = await Promise.all([presupuestoGeneral(), presupuestosDelMes(), listarSolicitudes(30)]);
  const porUsuario = new Map(filas.map((f) => [f.usuario_id, f]));
  const pendientes = solicitudes.filter((s) => s.estado === "pendiente");
  const resueltas = solicitudes.filter((s) => s.estado !== "pendiente").slice(0, 10);
  const mes = filas[0] ? MES.format(new Date(`${filas[0].mes}T00:00:00Z`)) : "";
  // Primero quienes ya gastaron: es a quienes se viene a revisar.
  const personas = [...filas].sort((a, b) => b.gasto_usd - a.gasto_usd || a.nombre.localeCompare(b.nombre, "es"));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Presupuestos</h2>
        <p className="max-w-prose text-sm text-neutral-500">
          Cuánto puede gastar cada persona en IA al mes. Cuenta el costo real de sus preguntas y de las fotos que adjunta. El tope de gasto de toda
          la app (pestaña Modelo de IA) sigue mandando: si se alcanza, nadie usa IA aunque le quede presupuesto.
        </p>
      </div>

      <section className="border border-neutral-200 bg-white p-4">
        <FormGeneral monto={general} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Solicitudes de ampliación <span className="font-normal text-neutral-500">({pendientes.length} pendientes)</span></h2>
        {pendientes.length === 0 ? (
          <p className="border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">No hay solicitudes pendientes.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
            {pendientes.map((s) => {
              const f = porUsuario.get(s.usuarioId);
              return (
                <li key={s.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{s.nombre}</span>
                    <span className="text-xs text-neutral-500">{fechaHora(s.solicitadaEn)}</span>
                  </div>
                  <p className="text-sm text-neutral-700">{s.motivo ? `«${s.motivo}»` : <span className="text-neutral-500">No escribió motivo.</span>}</p>
                  {f && (
                    <p className="text-xs text-neutral-500">
                      Este mes lleva {usd(f.gasto_usd)} en {f.preguntas} {f.preguntas === 1 ? "pregunta" : "preguntas"}
                      {f.limite_usd !== null && `, de un límite de ${usd(f.limite_usd)}`}
                      {f.ampliaciones_usd > 0 && ` (ya incluye ${usd(f.ampliaciones_usd)} de ampliaciones)`}.
                    </p>
                  )}
                  {/* Sugerencia: otro tanto de su presupuesto base. */}
                  <FormResolver solicitud={s} sugerido={f?.base_usd ?? general} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Personas {mes && <span className="font-normal text-neutral-500">· gasto de {mes}</span>}</h2>
        <div className="border border-neutral-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead className="text-right">Gasto del mes</TableHead>
                <TableHead className="text-right">Límite del mes</TableHead>
                <TableHead>Uso</TableHead>
                <TableHead>Presupuesto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {personas.map((f) => {
                const e = estadoPresupuesto(f);
                const pct = f.limite_usd ? Math.min(100, Math.round((f.gasto_usd / f.limite_usd) * 100)) : null;
                return (
                  <TableRow key={f.usuario_id} className="align-top">
                    <TableCell>
                      <div className="font-medium">{f.nombre}</div>
                      <div className="text-xs text-neutral-500">
                        {f.preguntas} {f.preguntas === 1 ? "pregunta" : "preguntas"} con IA{!f.activo && " · perfil inactivo"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd(f.gasto_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.limite_usd === null ? "Sin límite" : usd(f.limite_usd)}
                      {f.ampliaciones_usd > 0 && <div className="text-xs text-neutral-500">incluye {usd(f.ampliaciones_usd)} de ampliación</div>}
                    </TableCell>
                    <TableCell>
                      {pct === null ? <span className="text-xs text-neutral-500">—</span> : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 bg-neutral-200" role="img" aria-label={`${pct}% del límite usado`}>
                            <div className={`h-full ${e.agotado ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-neutral-900"}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-neutral-600">{pct}%</span>
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {e.agotado && <Badge variant="destructive">Agotado</Badge>}
                        {f.pendiente && <Badge variant="outline">Pidió ampliación</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="mb-1 text-xs text-neutral-600">
                        {f.origen === "sin_limite" ? (general === null ? "General (sin límite)" : "Sin límite") : `${usd(f.base_usd ?? 0)} al mes (${ORIGEN[f.origen]})`}
                      </div>
                      <FormPersona key={`${f.origen}-${f.base_usd}`} fila={f} general={general} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {resueltas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Solicitudes resueltas</h2>
          <ul className="space-y-1 border border-neutral-200 bg-white p-4 text-sm">
            {resueltas.map((s: Solicitud) => (
              <li key={s.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-neutral-500">{s.resueltaEn ? fechaHora(s.resueltaEn) : "—"}</span>
                <span>
                  {s.resueltaPor ?? "Alguien"} {s.estado === "aprobada" ? `aprobó ${usd(s.montoUsd ?? 0)} más para` : "rechazó la solicitud de"} {s.nombre}
                  {s.respuesta && <span className="text-neutral-500"> · «{s.respuesta}»</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
