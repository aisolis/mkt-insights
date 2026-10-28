import { KpiCard } from "@/components/kpi-card";

export default function Inicio() {
  // TODO G3: reemplazar por kpiPeriodo(), variacionPorDimension(), serieMensual() de @/lib/semantic/queries
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Desempeño comercial</h1>
        <p className="text-sm text-neutral-500">Selecciona periodo, comparación y filtros. Las cifras salen de la versión publicada.</p>
      </div>
      <div className="grid grid-cols-6 gap-3 text-sm">
        {["Periodo", "Comparar con", "Canal", "Territorio / ruta", "Marca", "Producto"].map((f) => (
          <label key={f} className="space-y-1">
            <span className="text-xs text-neutral-500">{f}</span>
            <select className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5" disabled><option>Todos</option></select>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-4">
        <KpiCard titulo="Venta neta" valor="—" variacion={null} />
        <KpiCard titulo="Volumen" valor="—" sufijo="t" variacion={null} />
        <KpiCard titulo="Precio promedio" valor="—" sufijo="L/kg" variacion={null} />
        <KpiCard titulo="Clientes con compra" valor="—" variacion={null} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between"><h2 className="font-medium">Venta neta mensual</h2><button className="text-xs text-neutral-500 underline" disabled>Preguntar al asistente</button></div>
          <div className="mt-4 h-56 rounded bg-neutral-50" />
        </section>
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="font-medium">Variación por canal</h2>
          <div className="mt-4 h-56 rounded bg-neutral-50" />
        </section>
      </div>
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between"><h2 className="font-medium">Rutas que más contribuyen a la variación</h2><button className="text-xs text-neutral-500 underline" disabled>Exportar</button></div>
        <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-neutral-500"><tr><th>Ruta</th><th>Canal</th><th>Actual</th><th>Anterior</th><th>Variación</th></tr></thead><tbody><tr><td colSpan={5} className="py-6 text-center text-neutral-400">Sin datos: publica una versión en Cargas y versiones.</td></tr></tbody></table>
        <p className="mt-3 text-xs text-neutral-500">Fuente: cubo de ventas BIA · versión — · cobertura —</p>
      </section>
    </div>
  );
}
