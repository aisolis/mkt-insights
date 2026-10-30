import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listarUsuarios, type FilaUsuario } from "@/lib/auth/admin";
import { requerirAdmin } from "@/lib/auth/acceso";
import { NIVEL_TXT } from "@/lib/auth/reglas";
import { fechaLocal } from "@/lib/format";
import { AccionUsuario, FormInvitar } from "./formularios";

const ESTADO: Record<FilaUsuario["estado"], { txt: string; variante: "default" | "secondary" | "outline" | "destructive" }> = {
  activo: { txt: "Activo", variante: "default" },
  sin_2fa: { txt: "Falta 2FA", variante: "secondary" },
  invitado: { txt: "Invitación pendiente", variante: "outline" },
  inactivo: { txt: "Desactivado", variante: "destructive" },
};

export default async function Perfiles() {
  const admin = await requerirAdmin();
  const usuarios = await listarUsuarios();
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
                  <TableCell>{NIVEL_TXT[u.nivel]}{u.esAdmin && " · admin"}{u.esAprobador && " · publica versiones"}</TableCell>
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
    </div>
  );
}
