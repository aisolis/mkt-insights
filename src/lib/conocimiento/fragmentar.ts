/**
 * Corta el texto de un PDF en fragmentos de ~1,200 caracteres con ~200 de solape, sin cruzar páginas (cada
 * cita apunta a una página). Corta en fin de párrafo u oración cuando puede.
 */
export type Fragmento = { orden: number; pagina: number; texto: string };

export function limpiar(texto: string) {
  return texto
    .replace(/\r/g, "")
    .replace(/(\w)-\n(\w)/g, "$1$2") // palabra partida con guion al final de línea
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fragmentar(paginas: string[], { objetivo = 1200, solape = 200, minimo = 40 } = {}): Fragmento[] {
  const salida: Fragmento[] = [];
  paginas.forEach((crudo, i) => {
    const texto = limpiar(crudo);
    if (texto.length < minimo) return;
    let inicio = 0;
    while (inicio < texto.length) {
      let fin = Math.min(texto.length, inicio + objetivo);
      if (fin < texto.length) {
        const ventana = texto.slice(inicio + Math.floor(objetivo * 0.6), fin);
        const corte = Math.max(ventana.lastIndexOf("\n\n"), ventana.lastIndexOf(". "), ventana.lastIndexOf("\n"));
        if (corte > 0) fin = inicio + Math.floor(objetivo * 0.6) + corte + 1;
      }
      const pedazo = texto.slice(inicio, fin).trim();
      if (pedazo.length >= minimo) salida.push({ orden: salida.length + 1, pagina: i + 1, texto: pedazo });
      if (fin >= texto.length) break;
      // El siguiente arranca `solape` caracteres antes, en un inicio de palabra.
      const atras = Math.max(inicio + 1, fin - solape);
      const espacio = texto.indexOf(" ", atras);
      inicio = espacio > 0 && espacio < fin ? espacio + 1 : fin;
    }
  });
  return salida;
}
