import "server-only";

/**
 * Correo saliente con la API REST de Resend (RESEND_API_KEY, RESEND_FROM). Solo envía con NODE_ENV=production:
 * en desarrollo y en pruebas registra en el log del servidor lo que se habría enviado y no llama a Resend.
 * Un correo por destinatario (endpoint batch): nadie ve las direcciones de los demás.
 */
export type Correo = { para: string[]; asunto: string; html: string; texto: string };
export type ResultadoCorreo =
  | { estado: "enviado"; destinatarios: number }
  | { estado: "desarrollo"; destinatarios: number }
  | { estado: "error"; error: string };

const LOTE = 100; // máximo de correos por llamada al endpoint batch de Resend

export async function enviarCorreo(c: Correo): Promise<ResultadoCorreo> {
  const para = [...new Set(c.para.map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+$/.test(x)))];
  if (!para.length) return { estado: "error", error: "No hay destinatarios con correo." };

  if (process.env.NODE_ENV !== "production") {
    console.info(`[correo] En desarrollo no se envían correos. Se habría enviado «${c.asunto}» a ${para.length} destinatario(s): ${para.join(", ")}\n${c.texto}`);
    return { estado: "desarrollo", destinatarios: para.length };
  }

  const llave = process.env.RESEND_API_KEY, de = process.env.RESEND_FROM;
  if (!llave || !de) return { estado: "error", error: "Falta configurar RESEND_API_KEY o RESEND_FROM." };
  for (let i = 0; i < para.length; i += LOTE) {
    const lote = para.slice(i, i + LOTE).map((to) => ({ from: de, to: [to], subject: c.asunto, html: c.html, text: c.texto }));
    try {
      const r = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json" },
        body: JSON.stringify(lote),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return { estado: "error", error: `Resend respondió ${r.status}: ${(await r.text()).slice(0, 200)}` };
    } catch (e) {
      return { estado: "error", error: `No se pudo contactar a Resend (${e instanceof Error ? e.message : e}).` };
    }
  }
  return { estado: "enviado", destinatarios: para.length };
}
