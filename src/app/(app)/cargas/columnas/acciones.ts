"use server";
import { revalidatePath } from "next/cache";
import { requerirGestorCargas } from "@/lib/auth/acceso";
import { CAMPOS, esCampo } from "@/lib/cargas/columnas";
import { agregarNombre, DatosColumna, DatosFormato, guardarColumna, guardarFormato, probarCarga, saltarHoja, separarLineas } from "@/lib/cargas/columnas-servidor";

export type Estado = { error?: string; ok?: string } | null;

const DESPUES = " Aplica desde la próxima carga; lo ya cargado no cambia.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const etiqueta = (campo: string) => (esCampo(campo) ? CAMPOS[campo].etiqueta : campo);

/** Nombre principal + alternativos (uno por línea, en orden) del formulario de un dato. */
function leerDato(form: FormData) {
  return DatosColumna.safeParse({
    campo: String(form.get("campo") ?? ""),
    encabezados: [String(form.get("principal") ?? "").trim(), ...separarLineas(String(form.get("alternativos") ?? ""))].filter(Boolean),
    obligatoria: form.get("puedeFaltar") !== "on",
  });
}

export async function guardarColumnaAccion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const datos = leerDato(form);
  if (!datos.success) return { error: datos.error.issues[0].message };
  const r = await guardarColumna(datos.data, usuario.id);
  if (r.error) return { error: r.error };
  revalidatePath("/cargas/columnas");
  return r.accion === "sin_cambios" ? { ok: "No había nada que cambiar." } : { ok: `Guardado: ${etiqueta(datos.data.campo)}.${DESPUES}` };
}

/** Prueba el cambio de un dato contra el archivo elegido arriba, sin guardarlo. */
export async function probarBorradorAccion(_: Estado, form: FormData): Promise<Estado> {
  await requerirGestorCargas();
  const datos = leerDato(form);
  if (!datos.success) return { error: datos.error.issues[0].message };
  const id = String(form.get("probar") ?? "");
  if (!UUID.test(id)) return { error: "Elige arriba un archivo para probar." };
  const p = await probarCarga(id, datos.data);
  if ("error" in p) return { error: p.error };
  const campo = datos.data.campo;
  const leidas = p.hojas.filter((h) => !h.excluida && h.lectura);
  if (!leidas.length) return { error: `«${p.carga.nombre_archivo}» no tiene hojas con encabezados para probar.` };
  const partes = leidas.map((h) => {
    const l = h.lectura!;
    const e = l.encontrados.find((x) => esCampo(campo) && x.campo === campo);
    const dato = e ? `se llena con «${e.encabezado}»${e.alternativo ? " (alternativo)" : ""}` : l.repetidos.some((r) => r.campo === campo) ? "viene en dos columnas con el mismo nombre" : "no aparece";
    return `«${h.hoja}»: ${dato}; la hoja ${l.valida ? "se cargaría" : "no se cargaría"}`;
  });
  return { ok: `Sin guardar, con ${p.carga.nombre_archivo}: ${partes.join(" · ")}.` };
}

/** Un clic desde el probador: el encabezado que trae el archivo pasa a ser un nombre alternativo del dato. */
export async function agregarNombreAccion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  // «encabezado»: el botón de la sugerencia; «elegido»: la lista de columnas que sobran.
  const campo = String(form.get("campo") ?? ""), encabezado = String(form.get("encabezado") || form.get("elegido") || "").trim();
  if (!esCampo(campo)) return { error: "Ese dato no existe." };
  if (!encabezado || encabezado.length > 100) return { error: "Elige una columna del archivo." };
  const r = await agregarNombre(campo, encabezado, usuario.id);
  if (r.error) return { error: r.error };
  revalidatePath("/cargas/columnas");
  return { ok: `«${encabezado}» quedó como nombre alternativo de ${CAMPOS[campo].etiqueta}.` };
}

export async function saltarHojaAccion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const hoja = String(form.get("hoja") ?? "").trim();
  if (!hoja || hoja.length > 100) return { error: "Hoja no válida." };
  const r = await saltarHoja(hoja, usuario.id);
  if (r.error) return { error: r.error };
  revalidatePath("/cargas/columnas");
  return { ok: `La hoja «${hoja}» se salta desde ahora, sin aviso.` };
}

export async function guardarFormatoAccion(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await requerirGestorCargas();
  const datos = DatosFormato.safeParse({ fila: form.get("fila"), hojas: separarLineas(String(form.get("hojas") ?? "")) });
  if (!datos.success) return { error: datos.error.issues[0].message };
  const r = await guardarFormato(datos.data, usuario.id);
  if (r.error) return { error: r.error };
  revalidatePath("/cargas/columnas");
  return r.accion === "sin_cambios" ? { ok: "No había nada que cambiar." } : { ok: `Guardado.${DESPUES}` };
}
