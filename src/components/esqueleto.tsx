/**
 * Esqueletos de carga: bloques grises que ocupan el lugar del contenido mientras llegan las cifras.
 * Solo presentación (sin estado ni efectos), para usarse en `loading.tsx` y como `fallback` de `<Suspense>`.
 */

/**
 * Anuncia la carga a lectores de pantalla; lo que dibuja adentro queda oculto para ellos.
 * `className` va en el contenedor de los bloques (rejilla, `space-y-*`, etc.).
 */
export function Cargando({ children, etiqueta = "Cargando…", className }: { children: React.ReactNode; etiqueta?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{etiqueta}</span>
      <div aria-hidden className={className}>{children}</div>
    </div>
  );
}

/** Un bloque gris; el tamaño lo da `className` (p. ej. `h-4 w-32`). */
export function Bloque({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-neutral-200/80 motion-safe:animate-pulse ${className}`} />;
}

/** Título de página y su subtítulo. */
export function EsqueletoEncabezado({ subtitulo = true, nivel = "pagina" }: { subtitulo?: boolean; nivel?: "pagina" | "seccion" }) {
  return (
    <div className="space-y-2">
      <Bloque className={nivel === "pagina" ? "h-7 w-56" : "h-6 w-40"} />
      {subtitulo && <Bloque className="h-4 w-full max-w-md" />}
    </div>
  );
}

/** Rejilla de tarjetas tipo KPI. `columnas` son las clases de la rejilla. */
export function EsqueletoTarjetas({ cantidad = 4, columnas = "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" }: { cantidad?: number; columnas?: string }) {
  return (
    <div className={`grid gap-4 ${columnas}`}>
      {Array.from({ length: cantidad }, (_, i) => (
        <div key={i} className="rounded-lg border border-neutral-200 bg-white p-4">
          <Bloque className="h-4 w-24" />
          <Bloque className="mt-2 h-7 w-28" />
          <Bloque className="mt-2 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/** Renglones de una tabla o lista. */
export function EsqueletoFilas({ filas = 5, columnas = 4 }: { filas?: number; columnas?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: columnas }, (_, j) => (
            <Bloque key={j} className={`h-4 ${j === 0 ? "flex-[2]" : "flex-1"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Sección con borde: título corto y, adentro, filas o un área de gráfica. */
export function EsqueletoSeccion({ filas = 4, columnas = 4, grafica = false, className = "" }: { filas?: number; columnas?: number; grafica?: boolean; className?: string }) {
  return (
    <section className={`rounded-lg border border-neutral-200 bg-white p-4 ${className}`}>
      <Bloque className="h-5 w-48" />
      <Bloque className="mt-2 h-3 w-64 max-w-full" />
      <div className="mt-4">{grafica ? <Bloque className="h-64 w-full" /> : <EsqueletoFilas filas={filas} columnas={columnas} />}</div>
    </section>
  );
}
