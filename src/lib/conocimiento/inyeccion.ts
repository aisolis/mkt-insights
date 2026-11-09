/**
 * Defensa contra instrucciones escondidas en un documento (V1-16, S32). Un estudio legítimo no le habla al asistente: un
 * fragmento que le da órdenes, intenta cambiar sus reglas o pide datos se marca al procesar el PDF y nunca se recupera.
 * Es una red de seguridad, no la única defensa: las instrucciones del modelo dicen que los extractos son datos, el
 * asistente solo tiene herramientas de lectura y toda cifra pasa por el verificador.
 */
const PATRONES: RegExp[] = [
  // español
  /\b(ignora|olvida|omite|desobedece)\b.{0,40}\b(instrucciones|reglas|indicaciones|lo anterior|todo lo anterior)\b/i,
  /\b(nuevas|siguientes)\s+instrucciones\s+(para|del)\s+(el\s+)?(asistente|modelo|sistema|ia)\b/i,
  /\b(eres|act[uú]a como|ahora eres)\b.{0,30}\b(asistente|modelo|ia|sistema)\b/i,
  /\b(asistente|modelo|ia)\s*[:,]\s*(debes|tienes que|responde|revela|muestra|env[ií]a)\b/i,
  /\b(revela|muestra|imprime|env[ií]a)\b.{0,40}\b(prompt|instrucciones del sistema|reglas internas|llaves?|claves?|contraseñas?)\b/i,
  // inglés
  /\b(ignore|disregard|forget)\b.{0,40}\b(instructions|rules|prompt|above|previous)\b/i,
  /\b(you are now|act as|new instructions|system prompt|developer message)\b/i,
  // marcas de rol de plantillas de chat
  /<\|?(system|im_start|assistant)\|?>|\[\/?INST\]|^\s*(system|assistant)\s*:/im,
];

export function pareceInstruccion(texto: string): boolean {
  const t = texto.normalize("NFC");
  return PATRONES.some((p) => p.test(t));
}
