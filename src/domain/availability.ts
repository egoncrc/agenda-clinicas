import { DateTime, Interval } from "luxon";
import type {
  Appointment,
  IsoWeekday,
  Service,
  Slot,
  TimeOff,
  WorkingHours,
} from "./types.js";

/**
 * Estados de cita que ocupan la agenda. Una cita cancelada o marcada como
 * no_show libera el hueco.
 */
const BLOCKING_STATUSES = new Set(["pendiente", "confirmada", "completada"]);

export interface AvailabilityInput {
  service: Service;
  /** Horarios laborales del odontólogo (uno o varios bloques por día). */
  workingHours: WorkingHours[];
  /** Ausencias del odontólogo (festivos, vacaciones, permisos). */
  timeOff: TimeOff[];
  /** Citas ya existentes del odontólogo. */
  appointments: Appointment[];
  /** Rango a explorar (fechas locales, inclusivas). */
  from: DateTime;
  to: DateTime;
  /** Paso entre inicios de hueco candidatos, en minutos. */
  slotStepMin: number;
  /** Instante actual; no se ofrecen huecos que empiecen en el pasado. */
  now: DateTime;
  /** Zona horaria IANA de la clínica (ej. "America/Guayaquil"). */
  timezone: string;
}

function parseHhMm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":");
  return { hour: Number(h), minute: Number(m) };
}

/**
 * Calcula los huecos disponibles de UN odontólogo para un servicio dado.
 *
 * Reglas aplicadas:
 * - El hueco debe caber completo dentro de un bloque de horario laboral.
 * - No debe solaparse con ausencias (time_off).
 * - No debe solaparse con citas existentes, respetando `bufferMin` de
 *   separación antes y después de cada cita.
 * - No debe empezar en el pasado.
 *
 * Todas las funciones son puras: reciben los datos ya cargados y no consultan
 * a Directus. Devuelve los huecos ordenados cronológicamente.
 */
export function computeAvailableSlots(input: AvailabilityInput): Slot[] {
  const {
    service,
    workingHours,
    timeOff,
    appointments,
    from,
    to,
    slotStepMin,
    now,
    timezone,
  } = input;

  const doctorId = workingHours[0]?.doctorId ?? appointments[0]?.doctorId ?? "";
  const durationMin = service.duracionMin;
  const bufferMin = service.bufferMin;

  // Intervalos ocupados por citas activas, expandidos por el buffer a cada lado
  // para garantizar separación entre citas.
  const busyIntervals: Interval[] = appointments
    .filter((a) => BLOCKING_STATUSES.has(a.estado))
    .map((a) =>
      Interval.fromDateTimes(
        DateTime.fromJSDate(a.inicio, { zone: timezone }).minus({ minutes: bufferMin }),
        DateTime.fromJSDate(a.fin, { zone: timezone }).plus({ minutes: bufferMin }),
      ),
    );

  const timeOffIntervals: Interval[] = timeOff.map((t) =>
    Interval.fromDateTimes(
      DateTime.fromJSDate(t.inicio, { zone: timezone }),
      DateTime.fromJSDate(t.fin, { zone: timezone }),
    ),
  );

  const hoursByWeekday = new Map<IsoWeekday, WorkingHours[]>();
  for (const wh of workingHours) {
    const list = hoursByWeekday.get(wh.diaSemana) ?? [];
    list.push(wh);
    hoursByWeekday.set(wh.diaSemana, list);
  }

  const slots: Slot[] = [];
  const startDay = from.setZone(timezone).startOf("day");
  const endDay = to.setZone(timezone).startOf("day");

  for (let day = startDay; day <= endDay; day = day.plus({ days: 1 })) {
    const weekday = day.weekday as IsoWeekday;
    const blocks = hoursByWeekday.get(weekday) ?? [];

    for (const block of blocks) {
      const { hour: sh, minute: sm } = parseHhMm(block.horaInicio);
      const { hour: eh, minute: em } = parseHhMm(block.horaFin);
      const blockStart = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const blockEnd = day.set({ hour: eh, minute: em, second: 0, millisecond: 0 });

      let candidateStart = blockStart;
      while (true) {
        const candidateEnd = candidateStart.plus({ minutes: durationMin });
        // El hueco debe caber completo dentro del bloque laboral.
        if (candidateEnd > blockEnd) break;

        const candidate = Interval.fromDateTimes(candidateStart, candidateEnd);
        const startsInFuture = candidateStart >= now;
        const clashesBusy = busyIntervals.some((b) => b.overlaps(candidate));
        const clashesTimeOff = timeOffIntervals.some((t) => t.overlaps(candidate));

        if (startsInFuture && !clashesBusy && !clashesTimeOff) {
          slots.push({
            doctorId,
            inicio: candidateStart.toJSDate(),
            fin: candidateEnd.toJSDate(),
          });
        }

        candidateStart = candidateStart.plus({ minutes: slotStepMin });
      }
    }
  }

  slots.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  return slots;
}

/**
 * Determina si una cita propuesta se solapa con alguna ausencia (time_off)
 * declarada del odontólogo. Igual que `hasOverlap`, se usa tanto en el
 * chequeo previo del servicio Node como de referencia para el hook de Directus.
 */
export function overlapsTimeOff(
  proposed: { inicio: Date; fin: Date },
  timeOff: TimeOff[],
  timezone: string,
): boolean {
  const candidate = Interval.fromDateTimes(
    DateTime.fromJSDate(proposed.inicio, { zone: timezone }),
    DateTime.fromJSDate(proposed.fin, { zone: timezone }),
  );
  return timeOff.some((t) =>
    Interval.fromDateTimes(
      DateTime.fromJSDate(t.inicio, { zone: timezone }),
      DateTime.fromJSDate(t.fin, { zone: timezone }),
    ).overlaps(candidate),
  );
}

/**
 * Determina si una cita propuesta se solapa con alguna cita activa del mismo
 * odontólogo (respetando el buffer). Se usa tanto en el chequeo previo del
 * servicio Node como de referencia para el hook de Directus.
 */
export function hasOverlap(
  proposed: { inicio: Date; fin: Date },
  existing: Appointment[],
  bufferMin: number,
  timezone: string,
): boolean {
  const candidate = Interval.fromDateTimes(
    DateTime.fromJSDate(proposed.inicio, { zone: timezone }),
    DateTime.fromJSDate(proposed.fin, { zone: timezone }),
  );
  return existing
    .filter((a) => BLOCKING_STATUSES.has(a.estado))
    .some((a) =>
      Interval.fromDateTimes(
        DateTime.fromJSDate(a.inicio, { zone: timezone }).minus({ minutes: bufferMin }),
        DateTime.fromJSDate(a.fin, { zone: timezone }).plus({ minutes: bufferMin }),
      ).overlaps(candidate),
    );
}
