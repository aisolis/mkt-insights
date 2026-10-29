import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { VersionBadge } from "@/components/version-badge";
import { versionVigente } from "@/lib/semantic/queries";
import { JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const jetbrainsMono = JetBrains_Mono({subsets:['latin'],variable:'--font-mono'});

export const metadata: Metadata = {
  title: "BIA Foresight",
  description: "Piloto · Marketing y Ventas",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const version = await versionVigente().then((v) => ({ v, error: false }), () => ({ v: null, error: true }));
  return (
    <html lang="es" className={cn("h-full antialiased", "font-mono", jetbrainsMono.variable)}>
      <body className="min-h-full bg-neutral-50 text-neutral-900">
        <AppShell version={<VersionBadge version={version.v} error={version.error} />}>{children}</AppShell>
      </body>
    </html>
  );
}
