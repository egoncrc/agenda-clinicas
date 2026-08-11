import { DateTime, Interval } from "luxon";

/** Debe coincidir con CLINIC_TIMEZONE del bot (src/config.ts). */
export const CLINIC_TIMEZONE = "America/Costa_Rica";

/** Debe coincidir con SLOT_STEP_MINUTES del bot (src/config.ts, default 15). */
export const SLOT_STEP_MINUTES = 15;

/**
 * Tamaño de un "espacio" de agenda tal como lo entiende la clínica, usado
 * únicamente por el reporte de Ocupación para contar espacios disponibles/
 * ocupados/libres. NO es lo mismo que `SLOT_STEP_MINUTES`: ese es el paso con
 * el que el bot BUSCA horas candidatas (cada 15'), no el tamaño real de una
 * cita — de hecho `duracion_min` de un servicio arranca en 30' por defecto. Usar
 * el paso de búsqueda del bot para contar espacios inflaba el denominador al
 * doble y hacía parecer la agenda menos ocupada de lo que está.
 */
export const REPORT_SLOT_MINUTES = 30;

export function now(): DateTime {
  return DateTime.now().setZone(CLINIC_TIMEZONE);
}

/** Día completo que contiene `anchor` (por defecto, hoy). */
export function todayRange(anchor?: DateTime): Interval {
  const d = anchor ?? now();
  return Interval.fromDateTimes(d.startOf("day"), d.endOf("day"));
}

/** Semana ISO (lunes a domingo) que contiene `anchor` (por defecto, hoy). */
export function weekRange(anchor?: DateTime): Interval {
  const d = anchor ?? now();
  return Interval.fromDateTimes(d.startOf("week"), d.endOf("week"));
}

/** Mes calendario completo que contiene `anchor` (por defecto, hoy). */
export function monthRange(anchor?: DateTime): Interval {
  const d = anchor ?? now();
  return Interval.fromDateTimes(d.startOf("month"), d.endOf("month"));
}

/**
 * Rango arbitrario a partir de dos fechas `yyyy-LL-dd` (lo que devuelve un
 * `<input type="date">`). Se interpretan en la zona de la clínica y se extienden
 * al día completo: quien escribe "del 1 al 5" espera que el día 5 entre entero,
 * no que se corte a medianoche.
 */
export function customRange(desdeYmd: string, hastaYmd: string): Interval {
  const desde = DateTime.fromFormat(desdeYmd, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE }).startOf("day");
  const hasta = DateTime.fromFormat(hastaYmd, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE }).endOf("day");
  return Interval.fromDateTimes(desde, hasta);
}

/** Todos los días (a medianoche) que toca un intervalo, incluidos el primero y el último. */
export function eachDay(interval: Interval): DateTime[] {
  const days: DateTime[] = [];
  let cursor = interval.start!.startOf("day");
  const last = interval.end!.startOf("day");
  // Comparación por día y no por instante: `endOf("day")` cae a las 23:59:59.999,
  // así que iterar hasta `interval.end` dejaría fuera el último día.
  while (cursor <= last) {
    days.push(cursor);
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

/** Todos los meses (día 1 a medianoche) que toca un intervalo. */
export function eachMonth(interval: Interval): DateTime[] {
  const months: DateTime[] = [];
  let cursor = interval.start!.startOf("month");
  const last = interval.end!.startOf("month");
  while (cursor <= last) {
    months.push(cursor);
    cursor = cursor.plus({ months: 1 });
  }
  return months;
}

export function formatMonth(dt: DateTime): string {
  return dt.setLocale("es").toFormat("LLLL yyyy");
}

/** `yyyy-LL-dd`, el formato que entiende un `<input type="date">`. */
export function toYmd(dt: DateTime): string {
  return dt.toFormat("yyyy-LL-dd");
}

/** El inverso de `toYmd` para mostrar en pantalla: `yyyy-LL-dd` como `dd/mm/yyyy`. */
export function formatYmd(ymd: string): string {
  const dt = DateTime.fromFormat(ymd, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
  return dt.isValid ? dt.toFormat("dd/LL/yyyy") : ymd;
}

export function formatDay(date: Date): string {
  return DateTime.fromJSDate(date, { zone: CLINIC_TIMEZONE }).setLocale("es").toFormat("cccc d 'de' LLLL");
}

export function formatTime(date: Date): string {
  return DateTime.fromJSDate(date, { zone: CLINIC_TIMEZONE }).toFormat("HH:mm");
}

export function formatDateTime(date: Date): string {
  return DateTime.fromJSDate(date, { zone: CLINIC_TIMEZONE }).setLocale("es").toFormat("d LLL, HH:mm");
}

/** Luxon puede devolver `null` para una fecha inválida; aquí siempre partimos de un valor válido. */
export function toIsoOrThrow(dt: DateTime): string {
  const iso = dt.toISO();
  if (!iso) throw new Error("Fecha inválida.");
  return iso;
}
