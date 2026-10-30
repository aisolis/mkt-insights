import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FormClave } from "../../formularios";
import { Titulo } from "../../titulo";

export default async function Clave() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login?aviso=enlace");
  // Si ya tiene 2FA (recuperación), primero el código: cambiar la clave con solo el enlace del correo no basta.
  if (data.claims.aal !== "aal2") {
    const { data: factores } = await supabase.auth.mfa.listFactors();
    if (factores?.totp.length) redirect("/auth/2fa?siguiente=/auth/clave");
  }
  return (
    <>
      <Titulo detalle={data.claims.email}>Define tu clave</Titulo>
      <FormClave />
    </>
  );
}
