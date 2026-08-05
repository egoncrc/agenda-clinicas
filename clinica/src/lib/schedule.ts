import { DateTime, Interval } from "luxon";
import type { AppointmentRow, AppointmentStatus, TimeOffRow, WorkingHoursRow } from "@/lib/directus";
import { CLINIC_TIMEZONE, SLOT_STEP_MINUTES } from "@/lib/dateRanges";

/** Estados que ocupan la agenda (igual que BLOCKING_STATUSES del bot, src/repositories/appointments.ts). */
const BLOCKING_STATUSES: AppointmentStatus[] = ["pendiente", "confirmada", "completada"];

export interface DaySlot {
  time: string; // "HH:mm"
  free: boolean;
}

/**
 * Huecos de `stepMinutes` (por defecto 30) dentro del horario laboral de un
 * médico para un día puntual, descontando ausencias (`time_off`) y citas
 * activas. Recibe ya filtrado por médico — quien llama decide el alcance
 * (uno o varios médicos).
 *
 * Reutiliza `computeAvailableStartTimes` (mismo motor que el modal de "Nueva
 * cita") para decidir qué huecos están libres, así ambas vistas comparten
 * exactamente las mismas reglas (ausencias, citas activas con buffer, no
 * empezar en el pasado). Sin `durationMin`/`bufferMin` explícitos (todavía no
 * hay un servicio elegido) se asume una duración genérica de `stepMinutes` y
 * buffer 0 — para servicios más largos o con buffer, esto puede mostrar como
 * libre un hueco que en realidad no alcanza; pasar el servicio real (como
 * hace el selector de "Horarios disponibles") da paridad exacta con el modal.
 */
export function computeDaySlots(
  dateStr: string,
  workingHours: WorkingHoursRow[],
  timeOff: TimeOffRow[],
  appointments: AppointmentRow[],
  options: { stepMinutes?: number; durationMin?: number; bufferMin?: number } = {},
): DaySlot[] {
  const stepMinutes = options.stepMinutes ?? 30;
  const durationMin = options.durationMin ?? stepMinutes;
  const bufferMin = options.bufferMin ?? 0;

  const day = DateTime.fromFormat(dateStr, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
  const weekday = day.weekday;

  const blocks = workingHours
    .filter((wh) => wh.dia_semana === weekday)
    .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
  if (blocks.length === 0) return [];

  const freeStarts = new Set(
    computeAvailableStartTimes({
      dateStr,
      workingHours,
      timeOff,
      appointments,
      durationMin,
      bufferMin,
      stepMinutes,
    }),
  );

  const slots: DaySlot[] = [];
  for (const block of blocks) {
    const [sh, sm] = block.hora_inicio.split(":").map(Number);
    const [eh, em] = block.hora_fin.split(":").map(Number);
    let cursor = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
    const end = day.set({ hour: eh, minute: em, second: 0, millisecond: 0 });

    while (cursor < end) {
      const time = cursor.toFormat("HH:mm");
      slots.push({ time, free: freeStarts.has(time) });
      cursor = cursor.plus({ minutes: stepMinutes });
    }
  }
  return slots;
}

/**
 * Horas de inicio disponibles para un médico en un día puntual, dada la
 * duración y el buffer del servicio elegido. Replica las mismas reglas que
 * `computeAvailableSlots` del bot (src/domain/availability.ts): el hueco debe
 * caber completo dentro de un bloque de horario laboral, no solaparse con
 * ausencias (time_off) ni con citas activas (respetando el buffer antes y
 * después de cada una), y no empezar en el pasado.
 *
 * A diferencia de `computeDaySlots` (huecos fijos de 30' para el vistazo
 * rápido de "Horarios disponibles"), esta función respeta la duración real
 * del servicio: el paso entre horas candidatas es `stepMinutes`, pero cada
 * hueco debe durar `durationMin` completos sin chocar con nada.
 */
export function computeAvailableStartTimes(input: {
  dateStr: string;
  workingHours: WorkingHoursRow[];
  timeOff: TimeOffRow[];
  appointments: AppointmentRow[];
  durationMin: number;
  bufferMin: number;
  stepMinutes?: number;
  now?: DateTime;
}): string[] {
  const stepMinutes = input.stepMinutes ?? SLOT_STEP_MINUTES;
  const now = input.now ?? DateTime.now().setZone(CLINIC_TIMEZONE);
  const day = DateTime.fromFormat(input.dateStr, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
  const weekday = day.weekday;

  const blocks = input.workingHours
    .filter((wh) => wh.dia_semana === weekday)
    .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));

  const busyIntervals = input.appointments
    .filter((a) => BLOCKING_STATUSES.includes(a.estado))
    .map((a) =>
      Interval.fromDateTimes(
        DateTime.fromISO(a.inicio, { zone: CLINIC_TIMEZONE }).minus({ minutes: input.bufferMin }),
        DateTime.fromISO(a.fin, { zone: CLINIC_TIMEZONE }).plus({ minutes: input.bufferMin }),
      ),
    );

  const timeOffIntervals = input.timeOff.map((t) =>
    Interval.fromDateTimes(
      DateTime.fromISO(t.inicio, { zone: CLINIC_TIMEZONE }),
      DateTime.fromISO(t.fin, { zone: CLINIC_TIMEZONE }),
    ),
  );

  const times: string[] = [];
  for (const block of blocks) {
    const [sh, sm] = block.hora_inicio.split(":").map(Number);
    const [eh, em] = block.hora_fin.split(":").map(Number);
    const blockStart = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
    const blockEnd = day.set({ hour: eh, minute: em, second: 0, millisecond: 0 });

    let candidateStart = blockStart;
    while (true) {
      const candidateEnd = candidateStart.plus({ minutes: input.durationMin });
      if (candidateEnd > blockEnd) break;

      const candidate = Interval.fromDateTimes(candidateStart, candidateEnd);
      const startsInFuture = candidateStart >= now;
      const clashesBusy = busyIntervals.some((b) => b.overlaps(candidate));
      const clashesTimeOff = timeOffIntervals.some((t) => t.overlaps(candidate));

      if (startsInFuture && !clashesBusy && !clashesTimeOff) {
        times.push(candidateStart.toFormat("HH:mm"));
      }

      candidateStart = candidateStart.plus({ minutes: stepMinutes });
    }
  }
  return times;
}

/**
 * Fechas dentro de `range` sin ningún hueco de inicio disponible — ya sea
 * porque el médico no trabaja ese día de la semana, tiene una ausencia que
 * cubre todo el bloque, o su agenda ya está llena para la duración/buffer
 * dados. Reutiliza `computeAvailableStartTimes` día por día en vez de
 * reimplementar las reglas: mismo criterio exacto que el resto del sistema.
 *
 * Marcar también los días sin horario laboral es redundante con
 * `disabledWeekdays` en `DatePicker.vue`, pero inofensivo — ambas
 * condiciones se combinan con OR ahí.
 */
export function computeUnavailableDates(
  range: { from: string; to: string },
  workingHours: WorkingHoursRow[],
  timeOff: TimeOffRow[],
  appointments: AppointmentRow[],
  options: { durationMin: number; bufferMin: number; stepMinutes?: number; now?: DateTime },
): string[] {
  const from = DateTime.fromFormat(range.from, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
  const to = DateTime.fromFormat(range.to, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
  const dates: string[] = [];
  for (let day = from; day <= to; day = day.plus({ days: 1 })) {
    const dateStr = day.toFormat("yyyy-LL-dd");
    const times = computeAvailableStartTimes({ dateStr, workingHours, timeOff, appointments, ...options });
    if (times.length === 0) dates.push(dateStr);
  }
  return dates;
}
