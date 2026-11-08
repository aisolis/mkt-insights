import { requerirAdmin } from "@/lib/auth/acceso";
import { listarReglas, seccionReglas, TOPE_REGLAS_ACTIVAS, ultimosCambios, type CambioRegla, type FilaRegla } from "@/lib/asistente/reglas-servidor";
import { fechaLocal } from "@/lib/format";
import { FormRegla, TarjetaRegla } from "./formularios";
import { ORDEN_TIPOS, TIPO_INFO } from "./textos";

const HORA_HN = new Intl.DateTimeFormat("es-HN", { timeZone: "America/Tegucigalpa", hour: "numeric", minute: "2-digit" });
/** "07-nov-2026, 2:30 p. m." en hora de Honduras. */
const cuando = (iso: string) => `${fechaLocal(iso)}, ${HORA_HN.format(new Date(iso))}`;

const VERBO: Record<CambioRegla["accion"], string> = {
  creada: "agregó", editada: "editó", activada: "activó", desactivada: "desactivó", eliminada: "eliminó",
};

const CON_ARTICULO: Record<FilaRegla["tipo"], string> = { instruccion: "la instrucción", definicion: "la definición", bloqueo: "el bloqueo" };

/** "Ana editó la definición «Ticket = venta neta / facturas.»" */
function describirCambio(c: CambioRegla) {
  const foto = c.despues ?? c.antes;
  if (!foto) return `${c.usuario ?? "Alguien"} ${VERBO[c.accion]} una regla`;
  const texto = foto.texto.length > 70 ? `${foto.texto.slice(0, 70)}…` : foto.texto;
  return `${c.usuario ?? "Alguien"} ${VERBO[c.accion]} ${CON_ARTICULO[foto.tipo]} «${texto}»`;
}

const ultimaModificacion = (r: FilaRegla) =>
  r.actualizadaEn !== r.creadaEn
    ? `Último cambio: ${r.actualizadaPor ?? "—"} · ${cuando(r.actualizadaEn)}`
    : `Agregada por ${r.creadaPor ?? "—"} · ${cuando(r.creadaEn)}`;

export default async function ReglasAsistente() {
  await requerirAdmin();
  const [reglas, cambios] = await Promise.all([listarReglas(), ultimosCambios(10)]);
  const activas = reglas.filter((r) => r.activa);
  const enviadas = seccionReglas(activas);
  const bloqueos = activas.filter((r) => r.tipo === "bloqueo");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Reglas</h2>
        <p className="text-sm text-neutral-500">
          Indicaciones, definiciones y temas bloqueados que el asistente aplica en cada pregunta, para todas las personas. Un
          cambio se aplica desde la siguiente pregunta.
        </p>
      </div>

      <section className="space-y-2 border border-neutral-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">Lo que ninguna regla puede cambiar</h2>
        <ul className="list-disc space-y-1 pl-5 text-neutral-700">
          <li>Las cifras siempre salen de las consultas a los datos publicados y se verifican antes de mostrarse: una regla no puede hacer que la IA calcule, estime ni invente números.</li>
          <li>Los datos de clientes individuales nunca se envían a la IA.</li>
          <li>Los temas que el piloto no cubre (participación de mercado, pronósticos, presupuesto, márgenes, inventario…) siguen bloqueados.</li>
          <li>Si una instrucción choca con las reglas fijas del asistente, mandan las reglas fijas.</li>
        </ul>
      </section>

      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Agregar una regla</h2>
          <span className={`text-xs ${activas.length >= TOPE_REGLAS_ACTIVAS ? "text-red-700" : "text-neutral-500"}`}>
            {activas.length} de {TOPE_REGLAS_ACTIVAS} reglas activas
          </span>
        </div>
        <FormRegla />
      </section>

      {cambios[0] && (
        <p className="text-sm text-neutral-600">
          <span className="font-medium text-neutral-900">Último cambio:</span> {describirCambio(cambios[0])} · {cuando(cambios[0].creadoEn)}
        </p>
      )}

      {ORDEN_TIPOS.map((tipo) => {
        const grupo = reglas.filter((r) => r.tipo === tipo);
        return (
          <section key={tipo} className="space-y-2">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold">{TIPO_INFO[tipo].plural} <span className="font-normal text-neutral-500">({grupo.length})</span></h2>
              <p className="text-xs text-neutral-500">{TIPO_INFO[tipo].que}</p>
            </div>
            {grupo.length === 0 ? (
              <p className="border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">Sin {TIPO_INFO[tipo].plural.toLowerCase()} todavía.</p>
            ) : (
              <ul className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
                {grupo.map((r) => <TarjetaRegla key={`${r.id}-${r.actualizadaEn}`} regla={r} cambio={ultimaModificacion(r)} />)}
              </ul>
            )}
          </section>
        );
      })}

      <section className="space-y-2">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold">Lo que recibe la IA</h2>
          <p className="text-xs text-neutral-500">
            Vista previa, solo lectura: este texto se agrega a las instrucciones fijas en cada pregunta, con las reglas activas de hoy.
          </p>
        </div>
        {enviadas.length ? (
          <pre className="overflow-x-auto border border-neutral-200 bg-neutral-50 p-3 text-xs whitespace-pre-wrap text-neutral-800">{enviadas.join("\n")}</pre>
        ) : (
          <p className="border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">
            No hay instrucciones ni definiciones activas: la IA recibe solo las instrucciones fijas.
          </p>
        )}
        {bloqueos.length > 0 && (
          <div className="space-y-1 text-xs text-neutral-600">
            <p>Los bloqueos no se envían a la IA: el sistema los revisa antes y, si la pregunta trae una de sus frases, responde así:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {bloqueos.map((b) => <li key={b.id}>«{b.terminos.join("», «")}» → No puedo responder eso. {b.texto}</li>)}
            </ul>
          </div>
        )}
      </section>

      {cambios.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Historial reciente</h2>
          <ul className="divide-y divide-neutral-200 border border-neutral-200 bg-white text-sm">
            {cambios.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span className="text-neutral-800">{describirCambio(c)}</span>
                <span className="text-xs text-neutral-500">{cuando(c.creadoEn)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
