import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "BIA Foresight",
  description: "Piloto · Marketing y Ventas",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-neutral-50 text-neutral-900">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
