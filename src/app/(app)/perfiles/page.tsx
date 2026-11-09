import { Badge } from "@/components/ui/badge";
import { describirEvento, eventosRecientes, FRASE_EVENTO, TIPO_EVENTO, type TipoEvento } from "@/lib/auditoria";
import { describirAlcance, listarUsuarios, opcionesAlcance, type FilaUsuario } from "@/lib/auth/admin";
import { requerirAdmin } from "@/lib/auth/acceso";
import { NIVEL_TXT } from "@/lib/auth/reglas";
import { fechaHoraLocal, fechaLocal } from "@/lib/format";
import { AccionUsuario, FormAlcance, FormInvitar } from "./formularios";

/** Lo que pide acción (falta 2FA, invitación pendiente) resalta; «Activo», el caso normal, queda en contorno. */
const ESTADO: Record<FilaUsuario["estado"], { txt: string; variante: "default" | "secondary" | "outline" | "destructive" }> = {
  activo: { txt: "Activo", variante: "outline" },
  sin_2fa: { txt: "Falta 2FA", variante: "secondary" },
  invitado: { txt: "Invitación pendiente", variante: "secondary" },
  inactivo: { txt: "Desactivado", variante: "destructive" },
};

const LIMITE_EVENTOS = 200;

export default async function Perfiles(props: PageProps<"/perfiles">) {
  const admin = await requerirAdmin();
  const sp = await props.searchParams;
  const tipo = typeof sp.evento === "string" && sp.evento in TIPO_EVENTO ? (sp.evento as TipoEvento) : undefined;
  // Sin opciones de ámbito (la consulta falló) la página sigue: solo el editor de ámbito avisa.
  const [usuarios, eventos, opciones] = await Promise.all([listarUsuarios(), eventosRecientes(LIMITE_EVENTOS, tipo), opcionesAlcance().catch(() => null)]);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Perfiles y accesos</h1>
        <p className="max-w-prose text-sm text-neutral-500">
          Acceso solo por invitación, con verificación en dos pasos obligatoria. Cada persona tiene un perfil (Estándar ve los agregados; Plus además el
          detalle por cliente), permisos (admin, publicar versiones) y un ámbito: la parte de la venta que ve.
        </p>
      </div>

      <section aria-labelledby="invitar" className="space-y-3 border border-neutral-200 bg-white p-4">
        <h2 id="invitar" className="text-sm font-semibold">Invitar a una persona</h2>
        <FormInvitar />
      </section>

      <section aria-labelledby="personas" className="space-y-2">
        <h2 id="personas" className="text-sm font-semibold">Personas ({usuarios.length})</h2>
        <ul className="divide-y divide-neutral-200 border border-neutral-200 bg-white">
          {usuarios.map((u) => <FilaPersona key={u.id} u={u} yo={u.id === admin.id} opciones={opciones} />)}
        </ul>
      </section>

      <section id="actividad" aria-labelledby="titulo-actividad" className="space-y-3 border border-neutral-200 bg-white p-4">
        <div className="space-y-1">
          <h2 id="titulo-actividad" className="text-sm font-semibold">Actividad: entradas, exportaciones y documentos</h2>
          <p className="max-w-prose text-sm text-neutral-500">
            Quién entró, salió, exportó o abrió un documento, y qué exportó (sin el contenido: los clientes no quedan aquí). Las preguntas al asistente
            están en su propia bitácora.
          </p>
        </div>
        <nav aria-label="Filtrar actividad" className="flex flex-wrap gap-x-4 text-sm">
          <a href="/perfiles#actividad" aria-current={!tipo ? "page" : undefined}
            className={`inline-flex min-h-8 items-center ${!tipo ? "font-semibold" : "underline underline-offset-2"}`}>Todo</a>
          {(Object.keys(TIPO_EVENTO) as TipoEvento[]).map((t) => (
            <a key={t} href={`/perfiles?evento=${t}#actividad`} aria-current={tipo === t ? "page" : undefined}
              className={`inline-flex min-h-8 items-center ${tipo === t ? "font-semibold" : "underline underline-offset-2"}`}>{TIPO_EVENTO[t]}</a>
          ))}
        </nav>
        {eventos.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin actividad registrada{tipo ? " de este tipo" : ""}.</p>
        ) : (
          <>
            <ul className="max-h-96 divide-y divide-neutral-100 overflow-y-auto text-sm">
              {eventos.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-2 py-1.5">
                  <span className="text-neutral-500 tabular-nums">{fechaHoraLocal(e.creado_en)}</span>
                  <span><span className="font-medium">{e.usuario ?? "Alguien"}</span> {FRASE_EVENTO[e.tipo]}</span>
                  {describirEvento(e) && <span className="min-w-0 break-words text-neutral-600">{describirEvento(e)}</span>}
                </li>
              ))}
            </ul>
            {eventos.length === LIMITE_EVENTOS && <p className="text-xs text-neutral-500">Se muestran los {LIMITE_EVENTOS} más recientes.</p>}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Una persona: quién es, qué acceso tiene y en qué estado, de un vistazo; «Editar» abre sus cambios agrupados (perfil,
 * permisos, ámbito) y, aparte y al final, desactivar. Los cambios que quitan acceso piden confirmación.
 */
function FilaPersona({ u, yo, opciones }: { u: FilaUsuario; yo: boolean; opciones: Awaited<ReturnType<typeof opcionesAlcance>> | null }) {
  const permisos = [u.esAdmin && "admin", u.esAprobador && "publica versiones"].filter(Boolean).join(" · ");
  return (
    <li>
      <details className="group">
        <summary className="grid cursor-pointer list-none gap-x-4 gap-y-1 px-4 py-3 hover:bg-neutral-50 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_auto_auto] sm:items-start [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div className="font-medium">{u.nombre}{yo && <span className="font-normal text-neutral-500"> (tú)</span>}</div>
            <div className="truncate text-xs text-neutral-500">{u.email}</div>
          </div>
          <div className="min-w-0 text-sm">
            <div>{NIVEL_TXT[u.nivel]}{permisos && <span className="text-neutral-600"> · {permisos}</span>}</div>
            <div className="text-xs text-neutral-600">Ámbito: {describirAlcance(u.alcance)}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 sm:block sm:space-y-1 sm:text-right">
            <Badge variant={ESTADO[u.estado].variante}>{ESTADO[u.estado].txt}</Badge>
            <div className="tabular-nums">
              {u.estado === "invitado" && u.invitadoEn ? `invitación del ${fechaLocal(u.invitadoEn)}`
                : u.ultimoIngreso ? `último ingreso ${fechaLocal(u.ultimoIngreso)}` : "sin ingresos"}
            </div>
          </div>
          <span className="inline-flex min-h-8 items-center text-sm underline underline-offset-2 sm:justify-self-end">
            <span className="group-open:hidden">Editar</span><span className="hidden group-open:inline">Cerrar</span>
            <span className="sr-only"> el acceso de {u.nombre}</span>
          </span>
        </summary>
        <div className="space-y-5 border-t border-neutral-200 bg-neutral-50 px-4 py-4">
          <Grupo titulo="Perfil">
            {u.nivel === "plus" ? (
              <AccionUsuario userId={u.id} nombre={u.nombre} accion="nivel" valor="estandar"
                si="Sí, pasar a Estándar" confirmar={`${u.nombre} deja de ver el detalle por cliente (pantalla Clientes y su exportación).`}>Pasar a Estándar</AccionUsuario>
            ) : (
              <AccionUsuario userId={u.id} nombre={u.nombre} accion="nivel" valor="plus">Pasar a Plus</AccionUsuario>
            )}
          </Grupo>
          <Grupo titulo="Permisos" nota={yo ? "Tu propio rol de admin no se cambia aquí: pídeselo a otro admin." : undefined}>
            {!yo && (u.esAdmin ? (
              <AccionUsuario userId={u.id} nombre={u.nombre} accion="admin" valor="no"
                si="Sí, quitar admin" confirmar={`${u.nombre} deja de administrar personas, documentos y el asistente.`}>Quitar admin</AccionUsuario>
            ) : (
              <AccionUsuario userId={u.id} nombre={u.nombre} accion="admin" valor="si">Hacer admin</AccionUsuario>
            ))}
            {u.esAprobador ? (
              <AccionUsuario userId={u.id} nombre={u.nombre} accion="aprobador" valor="no">Quitar permiso de publicar</AccionUsuario>
            ) : (
              <AccionUsuario userId={u.id} nombre={u.nombre} accion="aprobador" valor="si">Permitir publicar versiones</AccionUsuario>
            )}
          </Grupo>
          <Grupo titulo="Ámbito">
            <FormAlcance key={JSON.stringify(u.alcance)} userId={u.id} nombre={u.nombre} alcance={u.alcance} opciones={opciones} />
          </Grupo>
          {u.estado === "invitado" && (
            <Grupo titulo="Invitación">
              <AccionUsuario userId={u.id} nombre={u.nombre} accion="reenviar">Reenviar invitación</AccionUsuario>
            </Grupo>
          )}
          {!yo && (
            <div className="border-t border-neutral-200 pt-4">
              {u.activo ? (
                <AccionUsuario userId={u.id} nombre={u.nombre} accion="activo" valor="no" peligro si="Sí, desactivar"
                  confirmar={`${u.nombre} pierde el acceso de inmediato, también en las sesiones abiertas, y no puede volver a entrar. Se puede reactivar después.`}>
                  Desactivar
                </AccionUsuario>
              ) : (
                <AccionUsuario userId={u.id} nombre={u.nombre} accion="activo" valor="si">Reactivar</AccionUsuario>
              )}
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

function Grupo({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={titulo} className="space-y-2">
      <h3 className="text-sm font-medium">{titulo}</h3>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
      {nota && <p className="text-xs text-neutral-500">{nota}</p>}
    </div>
  );
}
