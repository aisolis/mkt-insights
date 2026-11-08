"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { salir } from "@/app/(auth)/acciones";
import { NIVEL_TXT, type Usuario } from "@/lib/auth/reglas";

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/asistente", label: "Asistente de IA" },
  { href: "/cargas", label: "Cargas y versiones" },
  { href: "/conocimiento", label: "Conocimiento" },
  { href: "/asistente/reglas", label: "Reglas del asistente", soloAdmin: true },
  { href: "/asistente/bitacora", label: "Bitácora del asistente", soloAdmin: true },
  { href: "/perfiles", label: "Perfiles y accesos", soloAdmin: true },
];

/**
 * Marco de la app: menú lateral fijo desde md; en pantallas angostas, menú desplegable desde el encabezado.
 * El encabezado mide siempre 3.25rem (h-13): el asistente calcula su alto con esa medida.
 */
export function AppShell({ children, version, usuario }: { children: React.ReactNode; version: React.ReactNode; usuario: Usuario }) {
  const path = usePathname();
  // El menú queda abierto solo en la ruta donde se abrió: al navegar se cierra solo.
  const [menuEn, setMenuEn] = useState<string | null>(null);
  const menu = menuEn === path;
  const setMenu = (abierto: boolean) => setMenuEn(abierto ? path : null);
  useEffect(() => {
    if (!menu) return;
    const cerrar = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuEn(null); };
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [menu]);

  const lateral = (
    <>
      <div className="mb-6">
        <div className="text-lg font-semibold">BIA Foresight</div>
        <div className="text-xs text-neutral-500">Piloto · Marketing y Ventas</div>
      </div>
      <nav className="space-y-1">
        {NAV.filter((n) => !n.soloAdmin || usuario.esAdmin).map((n) => (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setMenu(false)}
            className={`block rounded-md px-3 py-2 text-sm ${
              // Subpáginas (p. ej. una fila de la bitácora) marcan su sección; Inicio y el asistente solo en su ruta exacta.
              path === n.href || (n.href !== "/" && n.href !== "/asistente" && path.startsWith(`${n.href}/`)) ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-neutral-200 bg-white p-4 md:block">{lateral}</aside>
      {menu && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-neutral-900/30" onClick={() => setMenu(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 max-w-[85vw] overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={() => setMenu(false)} aria-label="Cerrar menú" className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {lateral}
            <div className="mt-6 border-t border-neutral-200 pt-4 text-xs text-neutral-600">
              <div className="font-medium text-neutral-900">{usuario.nombre}</div>
              Perfil {NIVEL_TXT[usuario.nivel]}{usuario.esAdmin && " · admin"}
            </div>
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="flex h-13 items-center justify-between gap-3 overflow-hidden border-b border-neutral-200 bg-white px-4 text-sm md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => setMenu(true)} aria-label="Abrir menú" aria-expanded={menu}
              className="-ml-1.5 rounded-md p-1.5 text-neutral-700 hover:bg-neutral-100 md:hidden">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <div className="min-w-0 truncate">{version}</div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-neutral-600">
            <span className="hidden lg:inline">
              <span className="font-medium text-neutral-900">{usuario.nombre}</span> · Perfil {NIVEL_TXT[usuario.nivel]}
              {usuario.esAdmin && " · admin"}
            </span>
            <form action={salir}>
              <button type="submit" className="text-xs underline-offset-4 hover:underline">Salir</button>
            </form>
          </div>
        </header>
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
