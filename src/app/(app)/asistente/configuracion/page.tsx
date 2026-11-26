import { requerirAdmin } from "@/lib/auth/acceso";
import { catalogoModelos, cambiosConfig, gastoMes, leerConfig, type CambioConfig, type FotoConfig, type GastoMes } from "@/lib/asistente/config-servidor";
import { usd } from "@/lib/asistente/dinero";
import { configModelo, modeloPermitido, modeloPorDefecto, modelosPermitidos } from "@/lib/asistente/modelo";
import { configEmbeddings } from "@/lib/conocimiento/embeddings";
import { fechaHora } from "./bitacora/textos";
import { FormModelo, FormPrueba, FormTope } from "./formularios";

const describir = (c: FotoConfig) =>
  c.usar_ia ? (c.modelo ?? "modelo por defecto") : "solo análisis automático";
const describirTope = (t: number | null | undefined) => (t === null || t === undefined ? "sin tope" : `tope de ${usd(Number(t))} al mes`);

/** Un cambio del historial en palabras: de modelo, de tope o de ambos. */
function textoCambio(c: CambioConfig) {
  const partes: React.ReactNode[] = [];
  if (c.antes.usar_ia !== c.despues.usar_ia || c.antes.modelo !== c.despues.modelo) {
    partes.push(<span key="m">de <span className="font-mono text-xs">{describir(c.antes)}</span> a <span className="font-mono text-xs">{describir(c.despues)}</span></span>);
  }
  // Los cambios anteriores a G9 no traen tope: no se comparan.
  if ("tope_mensual_usd" in c.despues && (c.antes.tope_mensual_usd ?? null) !== (c.despues.tope_mensual_usd ?? null)) {
    partes.push(<span key="t">{partes.length ? " y " : ""}de {describirTope(c.antes.tope_mensual_usd)} a {describirTope(c.despues.tope_mensual_usd)}</span>);
  }
  // Igual con el presupuesto por persona (0032), que se cambia en la pestaña Presupuestos.
  if ("presupuesto_usuario_usd" in c.despues && (c.antes.presupuesto_usuario_usd ?? null) !== (c.despues.presupuesto_usuario_usd ?? null)) {
    const p = (v: number | null | undefined) => (v === null || v === undefined ? "sin límite por persona" : `${usd(Number(v))} al mes por persona`);
    partes.push(<span key="p">{partes.length ? " y " : ""}el presupuesto de {p(c.antes.presupuesto_usuario_usd)} a {p(c.despues.presupuesto_usuario_usd)}</span>);
  }
  return partes.length ? partes : <span>sin cambios visibles</span>;
}

export default async function ConfiguracionModelo() {
  await requerirAdmin(); // el layout no se vuelve a ejecutar en cada navegación
  const [config, { modelos, error }, cambios, gasto] = await Promise.all([
    leerConfig(), catalogoModelos(), cambiosConfig(8),
    gastoMes().catch((e): GastoMes | null => { console.error("asistente: gasto del mes", e); return null; }),
  ]);
  const activo = configModelo(config);
  const porDefecto = modeloPorDefecto();
  const permitidos = modelosPermitidos();
  const conLlave = !!process.env.OPENROUTER_API_KEY?.trim();
  const embeddings = configEmbeddings();
  const enCatalogo = !activo || modelos.length === 0 || modelos.some((m) => m.id === activo.modelo);
  const activoPermitido = !activo || modeloPermitido(activo.modelo, permitidos);
  const enTope = !!activo && config.topeUsd !== null && !!gasto && gasto.totalUsd >= config.topeUsd;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Dato titulo="Responde ahora con" valor={activo && activoPermitido && !enTope ? activo.modelo : "Análisis automático"}
          nota={!activo ? (config.usarIa ? "falta la llave de OpenRouter en el servidor" : "la IA está apagada")
            : !activoPermitido ? `${activo.modelo} no está en la lista de permitidos`
            : enTope ? "se llegó al tope de gasto del mes" : config.modelo ? "elegido aquí" : "el por defecto del servidor"}
          mono={!!activo && activoPermitido && !enTope} />
        <Dato titulo="Gasto de IA este mes" valor={gasto ? usd(gasto.totalUsd) : "—"}
          nota={gasto
            ? `${config.topeUsd === null ? "Sin tope" : `De un tope de ${usd(config.topeUsd)} (${Math.min(100, Math.round((gasto.totalUsd / config.topeUsd) * 100))}%)`} · ${gasto.preguntas} preguntas con costo${gasto.pruebas ? ` y ${gasto.pruebas} pruebas` : ""}`
            : "No se pudo leer el gasto."} />
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
      {!activoPermitido && activo && (
        <p className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          El modelo configurado ({activo.modelo}) no está en la lista de modelos permitidos del servidor: mientras tanto el asistente responde con el
          análisis automático. Elige un modelo permitido.
        </p>
      )}
      {enTope && (
        <p className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Se llegó al tope de gasto del mes: las preguntas se responden con el análisis automático por reglas y la prueba de modelos está pausada. Sube el
          tope si hace falta seguir con IA este mes.
        </p>
      )}

      <section className="space-y-3 border border-neutral-200 bg-neutral-50/60 p-4">
        <FormModelo usarIa={config.usarIa} modelo={config.modelo} porDefecto={porDefecto} catalogo={modelos} errorCatalogo={error} conLlave={conLlave}
          permitidos={permitidos} porDefectoPermitido={modeloPermitido(porDefecto, permitidos)} />
        {config.actualizadaEn && config.actualizadaPor && (
          <p className="text-xs text-neutral-500">Último cambio: {config.actualizadaPor} · {fechaHora(config.actualizadaEn)}</p>
        )}
      </section>

      <section className="border border-neutral-200 bg-white p-4">
        <FormTope tope={config.topeUsd} />
      </section>

      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-semibold">Probar un modelo</h2>
          <p className="text-xs text-neutral-500">Compara modelos con la misma pregunta: tiempo, costo, si sus cifras pasaron la verificación y qué consultó.</p>
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
                <span>{c.usuario ?? "Alguien"} cambió {textoCambio(c)}</span>
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
