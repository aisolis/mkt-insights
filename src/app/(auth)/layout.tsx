/** Pantallas sin sesión completa (login, invitación, clave, 2FA): sin menú ni cifras. */
export default function LayoutAuth({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold">BIA Foresight</div>
          <div className="text-xs text-neutral-500">Piloto · Marketing y Ventas</div>
        </div>
        <div className="border border-neutral-200 bg-white p-6">{children}</div>
      </div>
    </main>
  );
}

