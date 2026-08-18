import { describe, expect, it } from "vitest";
import { isSessionExpired } from "@/lib/sessionErrors";

/** Forma real de un error del SDK: `errors[]` + la `Response` cruda. */
function directusError(code: string, status?: number): unknown {
  return {
    errors: [{ message: "algo", extensions: { code } }],
    ...(status ? { response: { status } } : {}),
  };
}

describe("isSessionExpired", () => {
  it("detecta un 401 por el status HTTP", () => {
    expect(isSessionExpired(directusError("FORBIDDEN", 401))).toBe(true);
  });

  it("detecta la sesión caída por código aunque no venga la response", () => {
    expect(isSessionExpired(directusError("INVALID_CREDENTIALS"))).toBe(true);
    expect(isSessionExpired(directusError("TOKEN_EXPIRED"))).toBe(true);
  });

  it("no confunde un rechazo de permisos con una sesión caída", () => {
    // Un 403 es "esta cuenta no puede hacer esto", no "hay que volver a entrar":
    // cerrarle la sesión al usuario por esto sería un bucle de login.
    expect(isSessionExpired(directusError("FORBIDDEN", 403))).toBe(false);
  });

  it("ignora los errores que no son de Directus", () => {
    expect(isSessionExpired(new Error("network down"))).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
    expect(isSessionExpired(undefined)).toBe(false);
  });
});
