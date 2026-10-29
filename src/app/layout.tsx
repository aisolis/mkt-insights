import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const jetbrainsMono = JetBrains_Mono({subsets:['latin'],variable:'--font-mono'});

export const metadata: Metadata = {
  title: "BIA Foresight",
  description: "Piloto · Marketing y Ventas",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={cn("h-full antialiased", "font-mono", jetbrainsMono.variable)}>
      <body className="min-h-full bg-neutral-50 text-neutral-900">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
