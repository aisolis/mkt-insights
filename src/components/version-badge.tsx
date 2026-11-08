import { fechaCorta } from "@/lib/format";
import type { VersionVigente } from "@/lib/semantic/contracts";

/**
 * Siempre visible: versión publicada, fecha de corte y estado de conciliación (prototipo p.1).
 * "Conciliada con BI" solo si la publicación lo dice: coincidir con el Excel no basta (CONTEXTO §5).
 */
export function VersionBadge({ version, error }: { version: VersionVigente | null; error?: boolean }) {
  if (error) return <Pill tono="rojo">Sin conexión a los datos</Pill>;
  if (!version) return <Pill tono="ambar">Sin versión publicada</Pill>;
  return (
    <div className="flex items-center gap-2 text-neutral-600">
      <span className="whitespace-nowrap"><span className="hidden sm:inline">Versión publicada </span><span className="font-medium text-neutral-900">v{version.version}</span></span>
      <span aria-hidden>·</span>
      {version.conciliada_bi ? <Pill tono="verde">conciliada con BI</Pill> : <Pill tono="ambar">sin conciliar con BI</Pill>}
      <span aria-hidden className="hidden sm:inline">·</span>
      <span className="hidden whitespace-nowrap sm:inline">corte {fechaCorta(version.fecha_corte)}</span>
    </div>
  );
}

const TONOS = {
  verde: "bg-emerald-100 text-emerald-800",
  ambar: "bg-amber-100 text-amber-800",
  rojo: "bg-red-100 text-red-800",
};

function Pill({ tono, children }: { tono: keyof typeof TONOS; children: React.ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONOS[tono]}`}>{children}</span>;
}
