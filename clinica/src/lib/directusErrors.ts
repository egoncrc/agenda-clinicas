import { isDirectusError } from "@directus/sdk";
import { PASSWORD_RULES } from "@/lib/passwordPolicy";

/**
 * Mensaje legible para errores de Directus. Distingue dos causas que ambas
 * llegan como 403 FORBIDDEN pero significan cosas distintas:
 * - El hook anti-solapes de Directus (directus-extensions/appointments-overlap-guard)
 *   rechaza la escritura con un mensaje que menciona "solapa".
 * - Un rechazo de permisos liso y llano (ej. el rol Doctor no tiene permiso
 *   de `create` en `appointments` — solo Recepción puede crear citas, ver CLAUDE.md).
 */
export function friendlyErrorMessage(error: unknown, fallback: string): string {
  if (isDirectusError(error)) {
    const message = error.errors[0]?.message ?? "";
    if (message.includes("solapa")) {
      return "Ese horario se solapa con otra cita de ese médico (incluyendo el tiempo de preparación entre citas).";
    }
    // PASSWORD_POLICY de Directus rechaza con el regex crudo en el mensaje
    // ("Value for field \"password\" doesn't match..."), ilegible para quien
    // solo quiere saber qué le falta a su contraseña.
    if (isPasswordValidationError(error)) {
      return `La contraseña no cumple los requisitos: ${PASSWORD_RULES.map((r) => r.label.toLowerCase()).join(", ")}.`;
    }
    const isForbidden = error.errors.some((e) => e.extensions.code === "FORBIDDEN");
    if (isForbidden) {
      return "No tienes permiso para esta acción.";
    }
    return message || fallback;
  }
  return fallback;
}

function isPasswordValidationError(error: unknown): boolean {
  if (!isDirectusError(error)) return false;
  return error.errors.some((e) => {
    if (e.extensions.code !== "FAILED_VALIDATION") return false;
    const field = (e.extensions as { field?: string }).field;
    return field === "password" || e.message.includes('"password"');
  });
}

/**
 * Mensaje legible para un fallo de `/auth/login`. Separado de
 * `friendlyErrorMessage` porque el login tiene códigos propios y porque decir
 * "correo o contraseña incorrectos" ante un problema de red o una cuenta
 * suspendida manda al usuario a resetear una contraseña que estaba bien.
 */
export function loginErrorMessage(error: unknown): string {
  if (isDirectusError(error)) {
    const code = error.errors[0]?.extensions.code;
    switch (code) {
      case "INVALID_CREDENTIALS":
        return "Correo o contraseña incorrectos.";
      case "INVALID_OTP":
        return "Falta el código de verificación en dos pasos.";
      case "USER_SUSPENDED":
        return "Tu usuario se encuentra inactivo. Contactá al administrador.";
      case "INVALID_PAYLOAD":
        return "Revisá que el correo esté bien escrito.";
      default:
        return error.errors[0]?.message ?? "No se pudo iniciar sesión.";
    }
  }
  // fetch lanza TypeError cuando no hay red o el servidor no responde.
  if (error instanceof TypeError) {
    return "No se pudo conectar con el servidor. Revisá tu conexión.";
  }
  return "No se pudo iniciar sesión.";
}
