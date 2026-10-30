import { redirect } from "next/navigation";
import { obtenerAcceso } from "@/lib/auth/acceso";
import { rutaSegura } from "@/lib/auth/reglas";
import { FormLogin } from "../formularios";
import { Titulo } from "../titulo";

const AVISOS: Record<string, string> = {
  enlace: "El enlace venció o ya se usó. Pide uno nuevo.",
  salida: "Cerraste sesión.",
};

export default async function Login(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const siguiente = rutaSegura(sp.siguiente, "");
  if ((await obtenerAcceso()).estado === "ok") redirect(siguiente || "/");
  const aviso = typeof sp.aviso === "string" ? AVISOS[sp.aviso] : undefined;
  return (
    <>
      <Titulo detalle="Acceso solo por invitación.">Entrar</Titulo>
      {aviso && <p className="mb-4 bg-neutral-100 p-2 text-sm text-neutral-700">{aviso}</p>}
      <FormLogin siguiente={siguiente} />
    </>
  );
}
