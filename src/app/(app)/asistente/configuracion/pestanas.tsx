"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PESTANAS = [
  { href: "/asistente/configuracion", label: "Modelo de IA" },
  { href: "/asistente/configuracion/reglas", label: "Reglas" },
  { href: "/asistente/configuracion/glosario", label: "Glosario" },
  { href: "/asistente/configuracion/bitacora", label: "Bitácora" },
];

export function Pestanas() {
  const path = usePathname();
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Secciones de la configuración">
      {PESTANAS.map((p) => {
        const activa = p.href === "/asistente/configuracion" ? path === p.href : path === p.href || path.startsWith(`${p.href}/`);
        return (
          <Link key={p.href} href={p.href} aria-current={activa ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${activa ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
