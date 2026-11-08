"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { salir } from "@/app/(auth)/acciones";
import { NIVEL_TXT, type Usuario } from "@/lib/auth/reglas";

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/asistente", label: "Asistente de IA" },
  { href: "/cargas", label: "Cargas y versiones" },
  { href: "/conocimiento", label: "Conocimiento" },
  { href: "/asistente/reglas", label: "Reglas del asistente", soloAdmin: true },
  { href: "/perfiles", label: "Perfiles y accesos", soloAdmin: true },
];

export function AppShell({ children, version, usuario }: { children: React.ReactNode; version: React.ReactNode; usuario: Usuario }) {
  const path = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-neutral-200 bg-white p-4">
        <div className="mb-6">
          <div className="text-lg font-semibold">BIA Foresight</div>
          <div className="text-xs text-neutral-500">Piloto · Marketing y Ventas</div>
        </div>
        <nav className="space-y-1">
          {NAV.filter((n) => !n.soloAdmin || usuario.esAdmin).map((n) => (
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
          <div className="flex items-center gap-3 text-neutral-600">
            <span>
              <span className="font-medium text-neutral-900">{usuario.nombre}</span> · Perfil {NIVEL_TXT[usuario.nivel]}
              {usuario.esAdmin && " · admin"}
            </span>
            <form action={salir}>
              <button type="submit" className="text-xs underline-offset-4 hover:underline">Salir</button>
            </form>
          </div>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
