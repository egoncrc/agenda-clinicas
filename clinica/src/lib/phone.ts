/** Separadores que la gente escribe dentro de un teléfono: `+506 8888-7777`, `(506) 8888.7777`. */
const PHONE_SEPARATORS = /[\s().-]/g;

const ONLY_DIGITS = /^\+?\d+$/;

/**
 * Decide si lo escrito en la búsqueda de paciente es un teléfono y no un nombre,
 * para precargar el campo correcto del alta. Deliberadamente laxo: no exige
 * longitud mínima ni prefijo de país — un texto de puros dígitos nunca es un
 * nombre, aunque esté incompleto, y dejarlo caer en el campo Nombre es peor que
 * precargar un teléfono a medias. No es validación de formato (ver `PHONE_RE` en
 * PublicBookingView), solo una heurística de a qué campo va lo que se tecleó.
 */
export function looksLikePhone(query: string): boolean {
  const compact = query.trim().replace(PHONE_SEPARATORS, "");
  return compact.length > 0 && ONLY_DIGITS.test(compact);
}
