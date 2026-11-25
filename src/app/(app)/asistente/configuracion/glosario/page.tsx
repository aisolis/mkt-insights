import { requerirAdmin } from "@/lib/auth/acceso";
import { lineaGlosario, MAX_TERMINOS_POR_PREGUNTA, TOPE_GLOSARIO } from "@/lib/asistente/glosario";
import { listarGlosario, type FilaGlosario } from "@/lib/asistente/glosario-servidor";
import { fechaLocal } from "@/lib/format";
import { FormCargar, FormTermino, TarjetaTermino } from "./formularios";

const ultimoCambio = (t: FilaGlosario) => `Último cambio: ${t.actualizadoPor ?? "—"} · ${fechaLocal(t.actualizadoEn)}`;

/** Glosario del asistente: términos de BIA que la IA recibe solo cuando la pregunta los menciona. */
export default async function GlosarioAsistente() {
  await requerirAdmin();
  const terminos = await listarGlosario();
  const activos = terminos.filter((t) => t.activo);
  const ejemplo = activos[0];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Glosario</h2>
        <p className="text-sm text-neutral-500">
          Términos de BIA y lo que significan. La IA recibe una definición solo cuando la pregunta menciona el término o una de sus
          otras formas, así que el glosario puede tener cientos de términos sin encarecer cada pregunta. Un cambio se aplica desde la
          siguiente pregunta.
        </p>
      </div>

      <section className="space-y-2 border border-neutral-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">Cómo se usa</h2>
        <ul className="list-disc space-y-1 pl-5 text-neutral-700">
          <li>Se compara sin tildes ni mayúsculas y como palabra o frase completa; el plural simple también cuenta («ruta» encuentra «rutas»).</li>
          <li>Por pregunta se envían como máximo {MAX_TERMINOS_POR_PREGUNTA} definiciones, primero las de los términos más específicos.</li>
          <li>Una definición explica un término; no cambia cómo se calculan las cifras ni puede saltarse las reglas fijas del asistente.</li>
          <li>Evita como término o sinónimo palabras muy comunes («venta», «mes»): se enviarían en casi todas las preguntas.</li>
        </ul>
      </section>

      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Agregar un término</h2>
          <span className={`text-xs ${terminos.length >= TOPE_GLOSARIO ? "text-red-700" : "text-neutral-500"}`}>{terminos.length} de {TOPE_GLOSARIO} términos</span>
        </div>
        <FormTermino />
      </section>

      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Cargar muchos términos desde un archivo</h2>
        <FormCargar />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Términos <span className="font-normal text-neutral-500">({terminos.length}{activos.length !== terminos.length && `, ${activos.length} activos`})</span></h2>
        {terminos.length === 0 ? (
          <p className="border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">El glosario está vacío.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
            {terminos.map((t) => <TarjetaTermino key={`${t.id}-${t.actualizadoEn}`} termino={t} cambio={ultimoCambio(t)} />)}
          </ul>
        )}
      </section>

      {ejemplo && (
        <section className="space-y-2">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold">Lo que recibe la IA</h2>
            <p className="text-xs text-neutral-500">
              Ejemplo, solo lectura: si la pregunta menciona «{ejemplo.termino}», este texto se agrega a las instrucciones de esa pregunta.
            </p>
          </div>
          <pre className="overflow-x-auto border border-neutral-200 bg-neutral-50 p-3 text-xs whitespace-pre-wrap text-neutral-800">{lineaGlosario(ejemplo)}</pre>
        </section>
      )}
    </div>
  );
}
