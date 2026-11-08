"use client";
import { Button } from "@/components/ui/button";

/** El navegador ofrece imprimir o "Guardar como PDF"; la hoja de estilos de impresión deja solo el resumen. */
export function BotonImprimir() {
  return <Button type="button" variant="outline" size="lg" onClick={() => window.print()}>Imprimir o guardar PDF</Button>;
}
