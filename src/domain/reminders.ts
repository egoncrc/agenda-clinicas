import { DateTime, Duration } from "luxon";

export type ReminderKind = "24h" | "2h";

const REMINDER_LEAD: Record<ReminderKind, Duration> = {
  "24h": Duration.fromObject({ hours: 24 }),
  "2h": Duration.fromObject({ hours: 2 }),
};

export interface ReminderableAppointment {
  inicio: Date;
  recordatorio24hEnviado: boolean;
  recordatorio2hEnviado: boolean;
}

function isDue(kind: ReminderKind, inicio: Date, now: Date): boolean {
  const triggerAt = DateTime.fromJSDate(inicio).minus(REMINDER_LEAD[kind]);
  return now >= triggerAt.toJSDate() && now < inicio;
}

/**
 * Recordatorios que corresponde disparar ahora mismo para esta cita.
 * Cada uno se dispara una sola vez (protegido por su propio flag); no depende
 * de que el scheduler corra en el minuto exacto, así que es robusto ante
 * caídas/reinicios del servicio (si estuvo caído mucho tiempo, puede devolver
 * ambos kinds de una vez).
 */
export function duesReminders(apt: ReminderableAppointment, now: Date): ReminderKind[] {
  const dues: ReminderKind[] = [];
  if (!apt.recordatorio24hEnviado && isDue("24h", apt.inicio, now)) dues.push("24h");
  if (!apt.recordatorio2hEnviado && isDue("2h", apt.inicio, now)) dues.push("2h");
  return dues;
}
