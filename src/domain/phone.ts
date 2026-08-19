const COUNTRY_CODE = "506";

/**
 * Formato de almacenamiento en Directus (`patients.telefono`): local
 * costarricense de 8 dígitos, sin "+506". Recorta el prefijo si viene
 * incluido (ej. mensajes entrantes de YCloud, que llegan en E.164); un
 * número que ya es local queda igual salvo por limpiar separadores.
 */
export function toLocalPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length > 8 && digits.startsWith(COUNTRY_CODE)) return digits.slice(COUNTRY_CODE.length);
  return digits;
}

/** Formato E.164 que exige YCloud para enviar mensajes por WhatsApp. */
export function toE164(local: string): string {
  const digits = local.replace(/\D/g, "");
  if (digits.length > 8 && digits.startsWith(COUNTRY_CODE)) return `+${digits}`;
  return `+${COUNTRY_CODE}${digits}`;
}
