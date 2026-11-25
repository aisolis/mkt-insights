import { AppShell } from "@/components/app-shell";
import { VersionBadge } from "@/components/version-badge";
import { requerirAcceso } from "@/lib/auth/acceso";
import { versionVigente } from "@/lib/semantic/queries";

/** Todo lo que muestra cifras vive aquí: sesión con 2FA y perfil activo, o fuera. */
export default async function LayoutApp({ children }: LayoutProps<"/">) {
  // La versión sale junto con el acceso, no después: comparten la sesión verificada del request y versionVigente()
  // solo lee su caché por usuario cuando el acceso ya pasó. Nunca rechaza (el error va al distintivo) y no se muestra
  // nada de ella si requerirAcceso() redirige.
  const version = versionVigente().then((v) => ({ v, error: false }), () => ({ v: null, error: true }));
  const usuario = await requerirAcceso();
  const { v, error } = await version;
  return (
    <AppShell usuario={usuario} version={<VersionBadge version={v} error={error} />}>
      {children}
    </AppShell>
  );
}
