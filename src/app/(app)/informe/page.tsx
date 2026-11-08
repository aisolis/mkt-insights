import { requerirAcceso } from "@/lib/auth/acceso";
import { leerInforme } from "@/lib/asistente/conversaciones";
import { BotonImprimir } from "./imprimir";
import { Informe } from "./informe";

/**
 * Al imprimir solo queda el informe: sin menú lateral ni barra superior (son de app-shell, aquí se ocultan por
 * etiqueta) y sin los botones de cada respuesta (print:hidden).
 */
const CSS_IMPRESION = `
@media print {
  @page { margin: 14mm; }
  aside, header, [role="dialog"] { display: none !important; }
  main { padding: 0 !important; }
  body { background: white !important; }
}`;

const HOY = new Intl.DateTimeFormat("es-HN", { timeZone: "America/Tegucigalpa", day: "numeric", month: "long", year: "numeric" });

/** Informe personal (G9): las respuestas del asistente que la persona fijó, en su orden, para imprimir o guardar en PDF. */
export default async function PaginaInforme() {
  const usuario = await requerirAcceso(); // el layout no se vuelve a ejecutar en cada navegación
  const items = await leerInforme(usuario.id);
  // Con lo guardado como key: después de un cambio, el servidor vuelve a pintar y la lista arranca de nuevo.
  const clave = items.map((i) => `${i.turnoId}:${i.titulo ?? ""}:${i.nota ?? ""}`).join("|");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <style>{CSS_IMPRESION}</style>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Informe</h1>
          <p className="text-sm text-neutral-500 print:hidden">
            Respuestas del asistente que agregaste con «Agregar al informe». Ordénalas, ponles título o una nota y guárdalas en PDF. Solo tú lo ves.
          </p>
          <p className="hidden text-sm text-neutral-600 print:block">
            {usuario.nombre} · {HOY.format(new Date())} · {items.length} {items.length === 1 ? "respuesta" : "respuestas"} del asistente de BIA Foresight.
            Cada una con la versión y el corte de datos con que se respondió.
          </p>
        </div>
        <BotonImprimir deshabilitado={!items.length} />
      </div>
      <Informe key={clave} items={items} />
    </div>
  );
}
