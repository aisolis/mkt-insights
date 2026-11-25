"use server";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { cambiarPerfil, guardarAlcance, invitar, reenviarInvitacion, type Alcance, type Cambio } from "@/lib/auth/admin";
import { requerirAdmin } from "@/lib/auth/acceso";
import { tagUsuario } from "@/lib/cache-usuario";

export type EstadoAccion = { error?: string; ok?: string } | null;

const Invitacion = z.object({
  email: z.email("Correo no válido.").transform((e) => e.toLowerCase()),
  nombre: z.string().trim().min(2, "Escribe el nombre.").max(80),
  nivel: z.enum(["estandar", "plus"]),
  esAdmin: z.boolean(),
});

export async function invitarUsuario(_: EstadoAccion, form: FormData): Promise<EstadoAccion> {
  const admin = await requerirAdmin();
  const datos = Invitacion.safeParse({ email: form.get("email"), nombre: form.get("nombre"), nivel: form.get("nivel"), esAdmin: form.get("esAdmin") === "on" });
  if (!datos.success) return { error: datos.error.issues[0].message };
  const r = await invitar(datos.data, admin.id);
  if (r.error) return r;
  revalidatePath("/perfiles");
  return { ok: `Invitación enviada a ${datos.data.email}.` };
}

const Accion = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("nivel"), valor: z.enum(["estandar", "plus"]) }),
  z.object({ accion: z.literal("admin"), valor: z.enum(["si", "no"]) }),
  z.object({ accion: z.literal("aprobador"), valor: z.enum(["si", "no"]) }),
  z.object({ accion: z.literal("activo"), valor: z.enum(["si", "no"]) }),
  z.object({ accion: z.literal("reenviar") }),
]);

export async function accionUsuario(_: EstadoAccion, form: FormData): Promise<EstadoAccion> {
  const admin = await requerirAdmin();
  const userId = z.uuid().safeParse(form.get("userId"));
  const datos = Accion.safeParse({ accion: form.get("accion"), valor: form.get("valor") ?? undefined });
  if (!userId.success || !datos.success) return { error: "Acción no válida." };
  const d = datos.data;
  // Nadie se quita a sí mismo el acceso o el rol de admin: evita quedarse sin administradores.
  if (userId.data === admin.id && (d.accion === "admin" || d.accion === "activo")) return { error: "No puedes cambiar tu propio acceso." };

  let r: { error?: string };
  if (d.accion === "reenviar") r = await reenviarInvitacion(userId.data);
  else {
    const cambio: Cambio = d.accion === "nivel" ? { nivel: d.valor } : d.accion === "admin" ? { esAdmin: d.valor === "si" }
      : d.accion === "aprobador" ? { esAprobador: d.valor === "si" } : { activo: d.valor === "si" };
    r = await cambiarPerfil(userId.data, cambio);
  }
  if (r.error) return r;
  revalidatePath("/perfiles");
  updateTag(tagUsuario(userId.data)); // su perfil y su versión vigente en caché (acceso.ts, queries.ts) se leen de nuevo
  // Qué cambió, dicho en el lugar del botón (el botón ya muestra el cambio contrario).
  const ok = d.accion === "reenviar" ? "Invitación reenviada."
    : d.accion === "nivel" ? `Ahora es ${d.valor === "plus" ? "Plus" : "Estándar"}.`
    : d.accion === "admin" ? (d.valor === "si" ? "Ahora es admin." : "Ya no es admin.")
    : d.accion === "aprobador" ? (d.valor === "si" ? "Ahora puede publicar versiones." : "Ya no publica versiones.")
    : d.valor === "si" ? "Acceso reactivado." : "Acceso desactivado: ya no puede entrar.";
  return { ok };
}

/** Ámbito de datos de una persona (V1-02): empresas, canales y rutas marcados; sin marcar nada = toda la venta. */
export async function guardarAlcanceAccion(_: EstadoAccion, form: FormData): Promise<EstadoAccion> {
  await requerirAdmin();
  const userId = z.uuid().safeParse(form.get("userId"));
  if (!userId.success) return { error: "Persona no válida." };
  const lista = (k: string) => [...new Set(form.getAll(k).map(String).filter(Boolean))].slice(0, 500);
  const partes = { empresa: lista("empresa"), canal: lista("canal"), ruta: lista("ruta") };
  const alcance: Alcance = form.get("todo") === "si" ? null
    : Object.fromEntries(Object.entries(partes).filter(([, v]) => v.length));
  const final = alcance && Object.keys(alcance).length ? alcance : null;
  const r = await guardarAlcance(userId.data, final);
  if (r.error) return r;
  revalidatePath("/perfiles");
  updateTag(tagUsuario(userId.data)); // la versión vigente en caché trae el ámbito: se lee de nuevo
  return { ok: final ? "Ámbito guardado: vale desde su próxima consulta." : "Ahora ve toda la venta interna." };
}

