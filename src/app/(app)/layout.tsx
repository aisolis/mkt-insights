import { AppShell } from "@/components/app-shell";
import { VersionBadge } from "@/components/version-badge";
import { requerirAcceso } from "@/lib/auth/acceso";
import { versionVigente } from "@/lib/semantic/queries";

/** Todo lo que muestra cifras vive aquí: sesión con 2FA y perfil activo, o fuera. */
export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const usuario = await requerirAcceso();
  const version = await versionVigente().then((v) => ({ v, error: false }), () => ({ v: null, error: true }));
  return (
    <AppShell usuario={usuario} version={<VersionBadge version={version.v} error={version.error} />}>
      {children}
    </AppShell>
  );
}
