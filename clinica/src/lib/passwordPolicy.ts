/**
 * Reglas de contraseña del panel. Única fuente de verdad: la usan las tres
 * pantallas de cambio (perfil, cambio obligatorio, restablecer por correo) y
 * el generador de `passwords.ts`.
 *
 * DEBE SER ESPEJO de la env var `PASSWORD_POLICY` del docker-compose de Directus:
 *
 *   PASSWORD_POLICY: "/^(?=.*[A-Za-z])(?=.*\\d).{10,}$/"
 *
 * Este archivo es la UX (feedback en vivo, en español, antes de mandar nada);
 * `PASSWORD_POLICY` es el borde real, porque se aplica también en
 * `/auth/password/reset`, donde el SPA podría saltarse con un curl. Si se
 * endurece uno, hay que endurecer el otro en el mismo despliegue.
 *
 * Reglas deliberadamente moderadas: las usan recepcionistas y médicos, no una
 * consola de infraestructura. Nada de "un símbolo obligatorio" — empuja a
 * `Password1!` y al post-it pegado al monitor.
 */
export const MIN_PASSWORD_LENGTH = 10;

/** Lista de reglas incumplidas por `pw`. Vacía = contraseña válida. */
export function passwordProblems(pw: string): string[] {
  const problems: string[] = [];
  if (pw.length < MIN_PASSWORD_LENGTH) problems.push(`Al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  if (!/[A-Za-zÁ-Úá-ú]/.test(pw)) problems.push("Al menos una letra.");
  if (!/\d/.test(pw)) problems.push("Al menos un número.");
  if (pw !== pw.trim()) problems.push("Sin espacios al principio ni al final.");
  return problems;
}

/** Las mismas reglas en positivo, para listarlas en la UI con su estado. */
export const PASSWORD_RULES: { label: string; ok: (pw: string) => boolean }[] = [
  { label: `Al menos ${MIN_PASSWORD_LENGTH} caracteres`, ok: (pw) => pw.length >= MIN_PASSWORD_LENGTH },
  { label: "Al menos una letra", ok: (pw) => /[A-Za-zÁ-Úá-ú]/.test(pw) },
  { label: "Al menos un número", ok: (pw) => /\d/.test(pw) },
];
