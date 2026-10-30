"use client";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmarEnlace, definirClave, enrolarTotp, iniciarSesion, pedirRecuperacion, verificarTotp,
  type Enrolamiento, type EstadoForm,
} from "./acciones";

function Campo({ etiqueta, ...props }: { etiqueta: string } & React.ComponentProps<typeof Input>) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-neutral-700">{etiqueta}</span>
      <Input {...props} className="h-9" />
    </label>
  );
}

function Mensaje({ estado }: { estado: EstadoForm }) {
  if (estado?.error) return <p role="alert" className="text-sm text-red-700">{estado.error}</p>;
  if (estado?.ok) return <p role="status" className="text-sm text-emerald-700">{estado.ok}</p>;
  return null;
}

export function FormLogin({ siguiente }: { siguiente?: string }) {
  const [estado, accion, enviando] = useActionState(iniciarSesion, null);
  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="siguiente" value={siguiente ?? ""} />
      <Campo etiqueta="Correo" name="email" type="email" autoComplete="username" required autoFocus />
      <Campo etiqueta="Clave" name="clave" type="password" autoComplete="current-password" required />
      <Mensaje estado={estado} />
      <Button type="submit" size="lg" className="w-full" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</Button>
      <p className="text-center text-xs"><Link href="/auth/recuperar" className="text-neutral-600 underline-offset-4 hover:underline">¿Olvidaste tu clave?</Link></p>
    </form>
  );
}

export function FormConfirmar({ tokenHash, tipo }: { tokenHash: string; tipo: "invite" | "recovery" }) {
  const [estado, accion, enviando] = useActionState(confirmarEnlace, null);
  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={tipo} />
      <Mensaje estado={estado} />
      <Button type="submit" size="lg" className="w-full" disabled={enviando}>
        {enviando ? "Verificando…" : tipo === "invite" ? "Aceptar invitación" : "Continuar"}
      </Button>
    </form>
  );
}

export function FormClave() {
  const [estado, accion, enviando] = useActionState(definirClave, null);
  return (
    <form action={accion} className="space-y-4">
      <Campo etiqueta="Clave nueva" name="clave" type="password" autoComplete="new-password" minLength={10} required autoFocus />
      <Campo etiqueta="Repite la clave" name="confirmacion" type="password" autoComplete="new-password" minLength={10} required />
      <p className="text-xs text-neutral-500">Al menos 10 caracteres, con letras y números.</p>
      <Mensaje estado={estado} />
      <Button type="submit" size="lg" className="w-full" disabled={enviando}>{enviando ? "Guardando…" : "Guardar clave"}</Button>
    </form>
  );
}

export function FormRecuperar() {
  const [estado, accion, enviando] = useActionState(pedirRecuperacion, null);
  return (
    <form action={accion} className="space-y-4">
      <Campo etiqueta="Correo" name="email" type="email" autoComplete="username" required autoFocus />
      <Mensaje estado={estado} />
      <Button type="submit" size="lg" className="w-full" disabled={enviando || !!estado?.ok}>{enviando ? "Enviando…" : "Enviar enlace"}</Button>
      <p className="text-center text-xs"><Link href="/login" className="text-neutral-600 underline-offset-4 hover:underline">Volver a entrar</Link></p>
    </form>
  );
}

function FormCodigo({ factorId, siguiente, boton }: { factorId?: string; siguiente?: string; boton: string }) {
  const [estado, accion, enviando] = useActionState(verificarTotp, null);
  return (
    <form action={accion} className="space-y-4">
      {factorId && <input type="hidden" name="factorId" value={factorId} />}
      <input type="hidden" name="siguiente" value={siguiente ?? ""} />
      <Campo etiqueta="Código de 6 dígitos" name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
      <Mensaje estado={estado} />
      <Button type="submit" size="lg" className="w-full" disabled={enviando}>{enviando ? "Verificando…" : boton}</Button>
    </form>
  );
}

export function Verificar2fa({ siguiente }: { siguiente?: string }) {
  return <FormCodigo siguiente={siguiente} boton="Verificar" />;
}

/** Primer ingreso: alta del factor TOTP con QR (o clave manual) y verificación del primer código. */
export function Configurar2fa({ siguiente }: { siguiente?: string }) {
  const [alta, setAlta] = useState<Enrolamiento | null>(null);
  const [cargando, iniciar] = useTransition();
  if (!alta || "error" in alta) {
    return (
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>Instala una app de autenticación en tu teléfono (Google Authenticator, Microsoft Authenticator o similar).</li>
          <li>Escanea el código QR que aparecerá.</li>
          <li>Escribe el código de 6 dígitos que muestra la app.</li>
        </ol>
        {alta && "error" in alta && <p role="alert" className="text-sm text-red-700">{alta.error}</p>}
        <Button size="lg" className="w-full" disabled={cargando} onClick={() => iniciar(async () => setAlta(await enrolarTotp()))}>
          {cargando ? "Preparando…" : "Configurar app de autenticación"}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL del QR, no pasa por next/image */}
      <img src={alta.qr} alt="Código QR para la app de autenticación" className="mx-auto size-48 border border-neutral-200 bg-white p-2" />
      <details className="text-xs text-neutral-600">
        <summary className="cursor-pointer">¿No puedes escanear? Escribe esta clave en la app</summary>
        <code className="mt-2 block break-all bg-neutral-100 p-2 font-mono text-neutral-900">{alta.secreto}</code>
      </details>
      <FormCodigo factorId={alta.factorId} siguiente={siguiente} boton="Activar y entrar" />
    </div>
  );
}
