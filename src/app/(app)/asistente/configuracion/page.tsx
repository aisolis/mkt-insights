import { requerirAdmin } from "@/lib/auth/acceso";
import { catalogoModelos, cambiosConfig, leerConfig, type CambioConfig } from "@/lib/asistente/config-servidor";
import { configModelo, modeloPorDefecto } from "@/lib/asistente/modelo";
import { configEmbeddings } from "@/lib/conocimiento/embeddings";
import { fechaHora } from "./bitacora/textos";
import { FormModelo, FormPrueba } from "./formularios";

const describir = (c: { usar_ia: boolean; modelo: string | null }) =>
  c.usar_ia ? (c.modelo ?? "modelo por defecto") : "solo análisis automático";

export default async function ConfiguracionModelo() {
  await requerirAdmin(); // el layout no se vuelve a ejecutar en cada navegación
  const [config, { modelos, error }, cambios] = await Promise.all([leerConfig(), catalogoModelos(), cambiosConfig(8)]);
  const activo = configModelo(config);
  const porDefecto = modeloPorDefecto();
  const conLlave = !!process.env.OPENROUTER_API_KEY?.trim();
  const embeddings = configEmbeddings();
  const enCatalogo = !activo || modelos.length === 0 || modelos.some((m) => m.id === activo.modelo);

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-3">
        <Dato titulo="Responde ahora con" valor={activo ? activo.modelo : "Análisis automático"}
          nota={activo ? (config.modelo ? "elegido aquí" : "el por defecto del servidor") : config.usarIa ? "falta la llave de OpenRouter en el servidor" : "la IA está apagada"} mono={!!activo} />
        <Dato titulo="Llave de OpenRouter" valor={conLlave ? "Configurada" : "Falta"} nota="Vive en el servidor; no se muestra ni se cambia desde aquí." />
        <Dato titulo="Búsqueda en documentos" valor={embeddings?.modelo ?? "Solo por palabras"} mono={!!embeddings}
          nota="Fijo: cambiarlo obliga a reprocesar todos los documentos de Conocimiento." />
      </section>
      {!enCatalogo && (
        <p className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          El modelo en uso ya no aparece en el catálogo de OpenRouter (pudo retirarse). Si las preguntas fallan, el asistente responde con el análisis
          automático; elige otro modelo.
        </p>
      )}

      <section className="space-y-3 border border-neutral-200 bg-neutral-50/60 p-4">
        <FormModelo usarIa={config.usarIa} modelo={config.modelo} porDefecto={porDefecto} catalogo={modelos} errorCatalogo={error} conLlave={conLlave} />
        {config.actualizadaEn && config.actualizadaPor && (
          <p className="text-xs text-neutral-500">Último cambio: {config.actualizadaPor} · {fechaHora(config.actualizadaEn)}</p>
        )}
      </section>

      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-semibold">Probar un modelo</h2>
          <p className="text-xs text-neutral-500">Compara modelos con la misma pregunta: tiempo, si sus cifras pasaron la verificación y qué consultó.</p>
        </div>
        {modelos.length > 0 ? <FormPrueba catalogo={modelos} sugerido={activo?.modelo ?? porDefecto} /> : <p className="text-sm text-neutral-500">Sin catálogo de modelos por ahora.</p>}
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-sm font-semibold">Qué no cambia con el modelo</h2>
        <ul className="list-disc space-y-1 pl-5 text-neutral-700">
          <li>Las cifras siempre salen de las consultas a la versión publicada y se verifican antes de mostrarse.</li>
          <li>Ningún modelo recibe datos de clientes: solo totales y variaciones ya calculados.</li>
          <li>Las reglas fijas y las del admin aplican igual con cualquier modelo.</li>
          <li>Los proveedores de OpenRouter tienen políticas de datos distintas; revisa la del modelo antes de usarlo en producción.</li>
        </ul>
      </section>

      {cambios.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Historial de cambios</h2>
          <ul className="space-y-1 border border-neutral-200 bg-white p-4 text-sm">
            {cambios.map((c: CambioConfig) => (
              <li key={c.creadoEn} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-neutral-500">{fechaHora(c.creadoEn)}</span>
                <span>{c.usuario ?? "Alguien"} cambió de <span className="font-mono text-xs">{describir(c.antes)}</span> a <span className="font-mono text-xs">{describir(c.despues)}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Dato({ titulo, valor, nota, mono }: { titulo: string; valor: string; nota: string; mono?: boolean }) {
  return (
    <div className="border border-neutral-200 bg-white p-4">
      <div className="text-xs text-neutral-500">{titulo}</div>
      <div className={`mt-1 break-all font-semibold ${mono ? "font-mono text-sm" : "text-lg"}`}>{valor}</div>
      <div className="mt-1 text-xs text-neutral-500">{nota}</div>
    </div>
  );
}
