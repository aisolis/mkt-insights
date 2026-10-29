"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/asistente", label: "Asistente de IA" },
  { href: "/cargas", label: "Cargas y versiones" },
  { href: "/conocimiento", label: "Conocimiento" },
  { href: "/perfiles", label: "Perfiles y accesos" },
];

export function AppShell({ children, version }: { children: React.ReactNode; version: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-neutral-200 bg-white p-4">
        <div className="mb-6">
          <div className="text-lg font-semibold">BIA Foresight</div>
          <div className="text-xs text-neutral-500">Piloto · Marketing y Ventas</div>
        </div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`block rounded-md px-3 py-2 text-sm ${
                path === n.href ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3 text-sm">
          {version}
          {/* TODO G5: usuario y perfil de la sesión */}
          <div className="text-neutral-600">Perfil: <span className="font-medium">—</span></div>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
