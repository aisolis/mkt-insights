export function Titulo({ children, detalle }: { children: React.ReactNode; detalle?: React.ReactNode }) {
  return (
    <div className="mb-5 space-y-1">
      <h1 className="text-base font-semibold">{children}</h1>
      {detalle && <p className="text-sm text-neutral-600">{detalle}</p>}
    </div>
  );
}
