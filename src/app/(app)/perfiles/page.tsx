import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describirEvento, eventosRecientes, TIPO_EVENTO, type TipoEvento } from "@/lib/auditoria";
import { describirAlcance, listarUsuarios, opcionesAlcance, type FilaUsuario } from "@/lib/auth/admin";
import { requerirAdmin } from "@/lib/auth/acceso";
import { NIVEL_TXT } from "@/lib/auth/reglas";
import { fechaHoraLocal, fechaLocal } from "@/lib/format";
import { AccionUsuario, FormAlcance, FormInvitar } from "./formularios";

const ESTADO: Record<FilaUsuario["estado"], { txt: string; variante: "default" | "secondary" | "outline" | "destructive" }> = {
  activo: { txt: "Activo", variante: "default" },
  sin_2fa: { txt: "Falta 2FA", variante: "secondary" },
  invitado: { txt: "Invitación pendiente", variante: "outline" },
  inactivo: { txt: "Desactivado", variante: "destructive" },
};

export default async function Perfiles(props: PageProps<"/perfiles">) {
  const admin = await requerirAdmin();
  const sp = await props.searchParams;
  const tipo = typeof sp.evento === "string" && sp.evento in TIPO_EVENTO ? (sp.evento as TipoEvento) : undefined;
  const [usuarios, eventos, opciones] = await Promise.all([listarUsuarios(), eventosRecientes(200, tipo), opcionesAlcance()]);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Perfiles y accesos</h1>
        <p className="text-sm text-neutral-500">
          Acceso solo por invitación, con verificación en dos pasos obligatoria. Estándar ve todos los agregados sin detalle de
          clientes; Plus verá además el detalle por cliente cuando exista.
        </p>
      </div>

      <section className="space-y-3 border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Invitar a una persona</h2>
        <FormInvitar />
      </section>

      <section className="border border-neutral-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Último ingreso</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios.map((u) => {
              const yo = u.id === admin.id;
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.nombre}{yo && <span className="font-normal text-neutral-500"> (tú)</span>}</div>
                    <div className="text-xs text-neutral-500">{u.email}</div>
                  </TableCell>
                  <TableCell className="align-top">
                    {NIVEL_TXT[u.nivel]}{u.esAdmin && " · admin"}{u.esAprobador && " · publica versiones"}
                    <FormAlcance userId={u.id} alcance={u.alcance} opciones={opciones} resumen={describirAlcance(u.alcance)} />
                  </TableCell>
                  <TableCell><Badge variant={ESTADO[u.estado].variante}>{ESTADO[u.estado].txt}</Badge></TableCell>
                  <TableCell className="text-neutral-600">{u.ultimoIngreso ? fechaLocal(u.ultimoIngreso) : "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <AccionUsuario userId={u.id} accion="nivel" valor={u.nivel === "plus" ? "estandar" : "plus"}>
                        Pasar a {u.nivel === "plus" ? "Estándar" : "Plus"}
                      </AccionUsuario>
                      {!yo && (
                        <AccionUsuario userId={u.id} accion="admin" valor={u.esAdmin ? "no" : "si"}>{u.esAdmin ? "Quitar admin" : "Hacer admin"}</AccionUsuario>
                      )}
                      <AccionUsuario userId={u.id} accion="aprobador" valor={u.esAprobador ? "no" : "si"}>
                        {u.esAprobador ? "Quitar publicar versiones" : "Puede publicar versiones"}
                      </AccionUsuario>
                      {!yo && (
                        <AccionUsuario userId={u.id} accion="activo" valor={u.activo ? "no" : "si"}>{u.activo ? "Desactivar" : "Reactivar"}</AccionUsuario>
                      )}
                      {u.estado === "invitado" && <AccionUsuario userId={u.id} accion="reenviar">Reenviar invitación</AccionUsuario>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      <section id="actividad" className="space-y-3 border border-neutral-200 bg-white p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Actividad: entradas y exportaciones</h2>
          <p className="max-w-prose text-sm text-neutral-500">
            Quién entró, salió, exportó o abrió un documento, y qué exportó (sin el contenido: los clientes no quedan aquí). Las preguntas al asistente
            están en su propia bitácora.
          </p>
        </div>
        <nav aria-label="Filtrar actividad" className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <a href="/perfiles#actividad" aria-current={!tipo ? "page" : undefined} className={!tipo ? "font-semibold" : "underline underline-offset-2"}>Todo</a>
          {(Object.keys(TIPO_EVENTO) as TipoEvento[]).map((t) => (
            <a key={t} href={`/perfiles?evento=${t}#actividad`} aria-current={tipo === t ? "page" : undefined}
              className={tipo === t ? "font-semibold" : "underline underline-offset-2"}>{TIPO_EVENTO[t]}</a>
          ))}
        </nav>
        {eventos.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin actividad registrada{tipo ? " de este tipo" : ""}.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-neutral-100 overflow-y-auto text-sm">
            {eventos.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 py-1">
                <span className="text-neutral-500 tabular-nums">{fechaHoraLocal(e.creado_en)}</span>
                <span className="font-medium">{e.usuario ?? "Alguien"}</span>
                <span>{TIPO_EVENTO[e.tipo].toLowerCase()}</span>
                {describirEvento(e) && <span className="min-w-0 break-words text-neutral-600">{describirEvento(e)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
