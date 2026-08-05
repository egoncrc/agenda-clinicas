import { passwordProblems } from "@/lib/passwordPolicy";

/**
 * Contraseña temporal para cuentas creadas desde el panel (wizard de alta,
 * gestión de clínica). El titular la cambia en su primer ingreso: el alta marca
 * `must_change_password: true` y el router lo lleva a `/cambiar-clave`.
 */

// Alfabetos sin caracteres ambiguos: ni I/O mayúsculas, ni l/o minúsculas, ni 0/1.
// Se dictan por teléfono y se copian a mano.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS;
const LENGTH = 14;

/**
 * Índice uniforme en [0, max) tomado de `crypto`, con muestreo por rechazo.
 *
 * `byte % max` estaría sesgado hacia los índices bajos siempre que 256 no sea
 * múltiplo de `max` (con 56 no lo es), así que se descartan los bytes de la
 * última franja incompleta.
 */
function randomIndex(max: number): number {
  const limit = Math.floor(256 / max) * max;
  const buf = new Uint8Array(1);
  let byte: number;
  do {
    crypto.getRandomValues(buf);
    byte = buf[0]!;
  } while (byte >= limit);
  return byte % max;
}

export function randomPassword(): string {
  // La composición se garantiza en vez de dejarla al azar. Con el alfabeto de
  // 56 caracteres (8 de ellos dígitos), la probabilidad de que 12 caracteres al
  // azar no contengan NINGÚN dígito es (48/56)^12 ≈ 16%: en cuanto Directus
  // tenga PASSWORD_POLICY activa, 1 de cada 6 altas del wizard fallaría con un
  // FAILED_VALIDATION incomprensible desde esa pantalla.
  const chars = [
    UPPER[randomIndex(UPPER.length)]!,
    LOWER[randomIndex(LOWER.length)]!,
    DIGITS[randomIndex(DIGITS.length)]!,
  ];
  while (chars.length < LENGTH) chars.push(ALL[randomIndex(ALL.length)]!);

  // Fisher-Yates, para que las tres primeras posiciones no queden fijas por clase.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  const pw = chars.join("");
  // Red de seguridad barata: si alguien endurece passwordPolicy.ts y se olvida
  // de este archivo, salta acá y no en un 400 de Directus a mitad del wizard.
  if (passwordProblems(pw).length > 0) {
    throw new Error("randomPassword generó una contraseña que no cumple la política.");
  }
  return pw;
}
