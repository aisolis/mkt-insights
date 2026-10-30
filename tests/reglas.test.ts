import { describe, expect, it } from "vitest";
import { esRutaPublica, evaluarAcceso, rutaSegura } from "@/lib/auth/reglas";
import { codigoTotp } from "./totp";

const perfil = { nombre: "Nati", nivel: "plus" as const, es_admin: true, activo: true };

describe("evaluarAcceso", () => {
  it("pide sesión, después 2FA, después perfil activo", () => {
    expect(evaluarAcceso(null, perfil).estado).toBe("sin_sesion");
    expect(evaluarAcceso({ sub: "u1", aal: "aal1" }, perfil).estado).toBe("sin_2fa");
    expect(evaluarAcceso({ sub: "u1", aal: "aal2" }, null).estado).toBe("sin_perfil");
    expect(evaluarAcceso({ sub: "u1", aal: "aal2" }, { ...perfil, activo: false }).estado).toBe("sin_perfil");
  });
  it("con aal2 y perfil activo devuelve el usuario", () => {
    expect(evaluarAcceso({ sub: "u1", aal: "aal2", email: "n@bia.hn" }, perfil)).toEqual({
      estado: "ok", usuario: { id: "u1", email: "n@bia.hn", nombre: "Nati", nivel: "plus", esAdmin: true, esAprobador: false },
    });
  });
});

describe("rutaSegura", () => {
  it("acepta rutas internas con query", () => expect(rutaSegura("/asistente?sobre=canal")).toBe("/asistente?sobre=canal"));
  it("rechaza URLs externas y protocol-relative", () => {
    for (const r of ["https://malo.com", "//malo.com", "/\\malo.com", "javascript:alert(1)", "", null, 3]) expect(rutaSegura(r)).toBe("/");
  });
  it("no vuelve al login ni al flujo de auth, salvo la clave tras el 2FA", () => {
    expect(rutaSegura("/login")).toBe("/");
    expect(rutaSegura("/auth/2fa")).toBe("/");
    expect(rutaSegura("/auth/clave")).toBe("/auth/clave");
  });
  it("rutas públicas", () => {
    expect(esRutaPublica("/login")).toBe(true);
    expect(esRutaPublica("/auth/confirmar")).toBe(true);
    expect(esRutaPublica("/")).toBe(false);
    expect(esRutaPublica("/api/asistente")).toBe(false);
  });
});

describe("codigoTotp", () => {
  // Vector de RFC 6238 (SHA-1): secreto "12345678901234567890", T = 59 s → 94287082 (8 dígitos) → 287082.
  it("coincide con el vector del RFC", () => expect(codigoTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082"));
});
