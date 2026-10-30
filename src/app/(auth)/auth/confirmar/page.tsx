import Link from "next/link";
import { FormConfirmar } from "../../formularios";
import { Titulo } from "../../titulo";

/** Destino de los enlaces de invitación y recuperación (plantillas en supabase/templates). */
export default async function Confirmar(props: PageProps<"/auth/confirmar">) {
  const sp = await props.searchParams;
  const tokenHash = typeof sp.token_hash === "string" ? sp.token_hash : "";
  const tipo = sp.type === "invite" || sp.type === "recovery" ? sp.type : null;
  if (!tokenHash || !tipo) {
    return (
      <>
        <Titulo detalle="El enlace está incompleto. Ábrelo de nuevo desde el correo.">Enlace no válido</Titulo>
        <Link href="/login" className="text-sm underline-offset-4 hover:underline">Ir a entrar</Link>
      </>
    );
  }
  return (
    <>
      <Titulo detalle={tipo === "invite" ? "Después definirás tu clave y la verificación en dos pasos." : "Después definirás tu clave nueva."}>
        {tipo === "invite" ? "Te damos la bienvenida" : "Restablecer clave"}
      </Titulo>
      <FormConfirmar tokenHash={tokenHash} tipo={tipo} />
    </>
  );
}
