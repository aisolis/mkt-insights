/**
 * PDF mínimo con texto seleccionable (Helvetica, WinAnsi) para probar la ingesta sin archivos reales.
 * Cada elemento de `paginas` es una página; cada string, una línea.
 */
export function pdfDePrueba(paginas: string[][]): Uint8Array {
  const esc = (s: string) =>
    [...s].map((c) => {
      const n = c.charCodeAt(0);
      if (c === "(" || c === ")" || c === "\\") return `\\${c}`;
      return n < 128 ? c : `\\${(n & 0xff).toString(8).padStart(3, "0")}`;
    }).join("");
  const objetos: string[] = [];
  const nPaginas = paginas.length;
  const idPagina = (i: number) => 4 + i * 2;
  objetos[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objetos[2] = `<< /Type /Pages /Kids [${paginas.map((_, i) => `${idPagina(i)} 0 R`).join(" ")}] /Count ${nPaginas} >>`;
  objetos[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  paginas.forEach((lineas, i) => {
    const flujo = `BT /F1 11 Tf 14 TL 50 790 Td ${lineas.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
    objetos[idPagina(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${idPagina(i) + 1} 0 R >>`;
    objetos[idPagina(i) + 1] = `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`;
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objetos.length; n++) {
    offsets[n] = pdf.length;
    pdf += `${n} 0 obj\n${objetos[n]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(pdf, (c) => c.charCodeAt(0));
}

/** Contenido ficticio, rotulado como tal: nunca se presenta como un estudio real. */
export const ESTUDIO_FICTICIO = [
  [
    "DOCUMENTO DE PRUEBA - contenido ficticio para validar la ingesta",
    "Estudio de hábitos de compra en el canal mayoreo",
    "Los mayoristas reportan que la temporada de lluvias reduce la frecuencia de compra",
    "de café molido en presentaciones grandes durante septiembre y octubre.",
    "Los compradores de mayoreo priorizan el precio por kilo sobre la marca.",
  ],
  [
    "Recomendaciones del estudio ficticio",
    "Reforzar la distribución de presentaciones pequeñas en el canal detalle",
    "cuando la temporada de lluvias afecta el abastecimiento de las tiendas.",
  ],
];
