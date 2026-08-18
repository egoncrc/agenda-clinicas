import { isDirectusError } from "@directus/sdk";

/**
 * ¿El fallo es "ya no hay sesión" y no "esta consulta salió mal"?
 *
 * Se usa solo sobre `directus.request(...)` (ver `lib/directus.ts`): el login
 * pasa por `client.login()` y la verificación de contraseña usa el cliente
 * efímero de `lib/reauth.ts`, así que unas credenciales mal tecleadas nunca se
 * evalúan acá — si no, un login fallido cerraría la sesión que intenta abrir.
 *
 * Se mira el status HTTP y además los códigos de Directus, porque no todos los
 * caminos del SDK adjuntan la `response` al error.
 */
export function isSessionExpired(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
  if (status === 401) return true;
  if (!isDirectusError(error)) return false;
  return error.errors.some(
    (e) => e.extensions?.code === "INVALID_CREDENTIALS" || e.extensions?.code === "TOKEN_EXPIRED",
  );
}
