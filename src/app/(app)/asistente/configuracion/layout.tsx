import { requerirAdmin } from "@/lib/auth/acceso";
import { Pestanas } from "./pestanas";

/** Todo lo del asistente que no es el chat, solo para admin: modelo, reglas y bitácora. */
export default async function LayoutConfiguracion({ children }: LayoutProps<"/asistente/configuracion">) {
  await requerirAdmin();
  return (
    <div className="space-y-6">
      <div className="space-y-3 border-b border-neutral-200">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Configuración del asistente</h1>
          <p className="text-sm text-neutral-500">Qué modelo de IA usa, qué reglas sigue y qué ha respondido. Los cambios aplican desde la siguiente pregunta.</p>
        </div>
        <Pestanas />
      </div>
      {children}
    </div>
  );
}
