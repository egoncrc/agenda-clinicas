import type { DateTime } from "luxon";
import type { IsoWeekday, WaitlistEntry, WaitlistPreference } from "./types.js";

function parseHhMm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":");
  return { hour: Number(h), minute: Number(m) };
}

/**
 * ¿Un hueco candidato satisface la preferencia de día/hora de una entrada de
 * lista de espera? Cada campo ausente ("cualquier día", "sin límite de hora")
 * no restringe. Puro: no consulta Directus.
 */
export function matchesPreference(
  pref: WaitlistPreference,
  slotStart: DateTime,
): boolean {
  if (pref.diaSemana != null && (slotStart.weekday as IsoWeekday) !== pref.diaSemana) {
    return false;
  }

  const slotMinutes = slotStart.hour * 60 + slotStart.minute;

  if (pref.horaDesde != null) {
    const { hour, minute } = parseHhMm(pref.horaDesde);
    if (slotMinutes < hour * 60 + minute) return false;
  }

  if (pref.horaHasta != null) {
    const { hour, minute } = parseHhMm(pref.horaHasta);
    if (slotMinutes > hour * 60 + minute) return false;
  }

  return true;
}

/**
 * Qué tan específica es una preferencia: 2 = día y hora, 1 = solo uno de los
 * dos, 0 = sin preferencia ("cualquier hueco"). Usado para priorizar a quién
 * se le ofrece primero un hueco liberado cuando varias entradas coinciden.
 */
export function specificityScore(pref: WaitlistPreference): number {
  const hasDay = pref.diaSemana != null;
  const hasHour = pref.horaDesde != null || pref.horaHasta != null;
  return (hasDay ? 1 : 0) + (hasHour ? 1 : 0);
}

/**
 * Ordena candidatas de lista de espera: preferencia más específica primero,
 * y en empate, quien se anotó primero (FIFO).
 */
export function rankCandidates<T extends WaitlistEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const bySpecificity = specificityScore(b) - specificityScore(a);
    if (bySpecificity !== 0) return bySpecificity;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
