import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requerirAcceso } from "@/lib/auth/acceso";
import { documentosVisibles, listarDocumentosAdmin, type FilaDocumentoAdmin } from "@/lib/conocimiento/servidor";
import { fechaCorta, fechaLocal } from "@/lib/format";
import { FormSubir, Reintentar, Vigencia } from "./formularios";

const ESTADO: Record<string, { txt: string; variante: "default" | "secondary" | "outline" | "destructive" }> = {
  listo: { txt: "Listo", variante: "default" },
  subiendo: { txt: "Subida incompleta", variante: "outline" },
  procesando: { txt: "Procesando", variante: "secondary" },
  error: { txt: "Error", variante: "destructive" },
  retirado: { txt: "Retirado", variante: "outline" },
};

export default async function Conocimiento() {
  const usuario = await requerirAcceso();
  const [visibles, todos] = await Promise.all([documentosVisibles(), usuario.esAdmin ? listarDocumentosAdmin() : Promise.resolve(null)]);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Conocimiento</h1>
        <p className="text-sm text-neutral-500">
          Estudios y documentos autorizados que el asistente cita como contexto. Lo que dicen no son datos de venta: el asistente
          los muestra aparte de los hechos del cubo, con documento y página.
        </p>
      </div>

      {usuario.esAdmin && (
        <section className="space-y-3 border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Subir un documento</h2>
          <FormSubir />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Documentos disponibles</h2>
        {visibles.length === 0 ? (
          <p className="border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">Todavía no hay documentos autorizados.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
            {visibles.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="space-y-0.5">
                  <div className="font-medium">{d.titulo}</div>
                  <div className="text-xs text-neutral-500">
                    {d.fuente}{d.fecha_documento && ` · ${fechaCorta(d.fecha_documento)}`}{d.paginas && ` · ${d.paginas} págs.`}
                    {d.audiencia === "plus" && " · solo Plus"}
                  </div>
                  {d.descripcion && <p className="text-sm text-neutral-700">{d.descripcion}</p>}
                </div>
                <a href={`/api/conocimiento/${d.id}`} target="_blank" rel="noopener" className="text-sm underline-offset-4 hover:underline">Abrir PDF</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {todos && <Administracion filas={todos} />}
    </div>
  );
}

function Administracion({ filas }: { filas: FilaDocumentoAdmin[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Todos los documentos (admin)</h2>
      <div className="border border-neutral-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Documento</TableHead>
              <TableHead>Audiencia</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Índice</TableHead>
              <TableHead>Subido</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <div className="font-medium">{d.titulo}</div>
                  <div className="text-xs text-neutral-500">{d.fuente} · {d.nombre_archivo}</div>
                  {d.error && <div className="max-w-80 text-xs whitespace-normal text-red-700">{d.error}</div>}
                </TableCell>
                <TableCell>{d.audiencia === "plus" ? "Solo Plus" : "Todos"}</TableCell>
                <TableCell><Badge variant={ESTADO[d.estado]?.variante ?? "outline"}>{ESTADO[d.estado]?.txt ?? d.estado}</Badge></TableCell>
                <TableCell className="text-xs text-neutral-600">
                  {d.fragmentos ? `${d.fragmentos} fragmentos · ${d.paginas} págs.` : "—"}
                  {d.fragmentos > 0 && <div>{d.modelo_embedding ? `semántica: ${d.modelo_embedding}` : "solo texto"}</div>}
                </TableCell>
                <TableCell className="text-neutral-600">{fechaLocal(d.creado_en)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {d.estado === "listo" && <Vigencia id={d.id} vigente={false}>Retirar</Vigencia>}
                    {d.estado === "retirado" && d.fragmentos > 0 && <Vigencia id={d.id} vigente>Reactivar</Vigencia>}
                    {(d.estado === "error" || d.estado === "subiendo") && <Reintentar id={d.id} />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
