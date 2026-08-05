import { DateTime, Interval } from "luxon";

/**
 * Matemática de la ocupación de agenda. Puro: sin Directus, sin stores, sin
 * `now()`. Todo entra por parámetro y todo sale calculado, que es lo que permite
 * probarlo (`occupancy.test.ts`) sin levantar nada — mismo criterio que el motor
 * de disponibilidad del bot (src/domain/availability.ts).
 *
 * La idea completa en tres pasos:
 *   1. Horas de agenda = los `working_hours` proyectados sobre cada día del rango.
 *   2. Menos las ausencias (`time_off`) que las pisen.
 *   3. Las citas se RECORTAN contra lo que quedó. Una cita fuera del horario
 *      declarado (encaje de última hora, arrastre) no debe empujar la ocupación
 *      por encima del 100% ni inflar el denominador: se cuenta aparte en
 *      `minutosFueraDeHorario`, donde se ve y se puede explicar.
 */

export interface OccupancyWorkingHours {
  doctor: string;
  /** 1 = lunes … 7 = domingo (ISO, igual que Luxon). */
  dia_semana: number;
  /** "HH:mm:ss". */
  hora_inicio: string;
  hora_fin: string;
}

export interface OccupancyTimeOff {
  doctor: string;
  inicio: string; // ISO
  fin: string; // ISO
}

export interface OccupancyAppointment {
  doctor: string;
  inicio: string; // ISO
  fin: string; // ISO
}

export interface OccupancyInput {
  /** Extremos del rango, ISO. */
  desde: string;
  hasta: string;
  timezone: string;
  workingHours: OccupancyWorkingHours[];
  timeOff: OccupancyTimeOff[];
  /** Ya filtradas a los estados que ocupan agenda. */
  appointments: OccupancyAppointment[];
}

export interface DoctorOccupancy {
  doctorId: string;
  minutosDisponibles: number;
  minutosOcupados: number;
  citas: number;
  /** Minutos de cita que caen fuera del horario declarado (o dentro de una ausencia). */
  minutosFueraDeHorario: number;
}

export interface HourBucket {
  /** Hora del día, 0-23, en la zona de la clínica. */
  hora: number;
  minutosDisponibles: number;
  minutosOcupados: number;
  /** Citas que EMPIEZAN en esta hora: es lo que significa "hora pico" para quien agenda. */
  citas: number;
}

export interface OccupancyResult {
  porMedico: DoctorOccupancy[];
  porHora: HourBucket[];
  totales: Omit<DoctorOccupancy, "doctorId">;
}

function parseHhMm(day: DateTime, hhmmss: string): DateTime | null {
  const [h, m] = hhmmss.split(":");
  const hour = Number(h);
  const minute = Number(m ?? 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

function minutes(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + i.length("minutes"), 0);
}

/**
 * Reparte los minutos de un intervalo entre las horas del día que toca. Un
 * bloque de 09:30 a 11:00 aporta 30 minutos a la hora 9 y 60 a la hora 10.
 */
function addToHourBuckets(interval: Interval, buckets: Map<number, HourBucket>, key: "minutosDisponibles" | "minutosOcupados"): void {
  let cursor = interval.start!;
  const end = interval.end!;
  while (cursor < end) {
    const nextHour = cursor.plus({ hours: 1 }).startOf("hour");
    const sliceEnd = nextHour < end ? nextHour : end;
    const bucket = bucketFor(buckets, cursor.hour);
    bucket[key] += sliceEnd.diff(cursor, "minutes").minutes;
    cursor = sliceEnd;
  }
}

function bucketFor(buckets: Map<number, HourBucket>, hora: number): HourBucket {
  let bucket = buckets.get(hora);
  if (!bucket) {
    bucket = { hora, minutosDisponibles: 0, minutosOcupados: 0, citas: 0 };
    buckets.set(hora, bucket);
  }
  return bucket;
}

export function computeOccupancy(input: OccupancyInput): OccupancyResult {
  const { timezone } = input;
  const rango = Interval.fromDateTimes(
    DateTime.fromISO(input.desde, { zone: timezone }),
    DateTime.fromISO(input.hasta, { zone: timezone }),
  );

  // Un médico entra al reporte si tiene agenda O citas: los dos casos asimétricos
  // son informativos (agenda sin citas = 0% de ocupación; citas sin agenda = todo
  // fuera de horario) y esconder cualquiera de ellos falsearía los totales.
  const doctorIds = new Set<string>([
    ...input.workingHours.map((w) => w.doctor),
    ...input.appointments.map((a) => a.doctor),
  ]);

  const horasPorDia = new Map<number, OccupancyWorkingHours[]>();
  for (const wh of input.workingHours) {
    const list = horasPorDia.get(wh.dia_semana) ?? [];
    list.push(wh);
    horasPorDia.set(wh.dia_semana, list);
  }

  const dias: DateTime[] = [];
  {
    let cursor = rango.start!.startOf("day");
    const last = rango.end!.startOf("day");
    while (cursor <= last) {
      dias.push(cursor);
      cursor = cursor.plus({ days: 1 });
    }
  }

  const buckets = new Map<number, HourBucket>();
  const porMedico: DoctorOccupancy[] = [];

  for (const doctorId of doctorIds) {
    // Paso 1: proyectar el horario semanal sobre cada día del rango.
    const bloques: Interval[] = [];
    for (const day of dias) {
      for (const wh of horasPorDia.get(day.weekday) ?? []) {
        if (wh.doctor !== doctorId) continue;
        const inicio = parseHhMm(day, wh.hora_inicio);
        const fin = parseHhMm(day, wh.hora_fin);
        if (!inicio || !fin || fin <= inicio) continue;
        // Recorte contra el rango: el primer y el último día pueden entrar a medias
        // cuando el rango no empieza a medianoche.
        const bloque = Interval.fromDateTimes(inicio, fin).intersection(rango);
        if (bloque && bloque.isValid && bloque.length("minutes") > 0) bloques.push(bloque);
      }
    }

    // Se fusionan antes de restar: un médico con dos sedes el mismo día puede
    // tener tramos solapados por error de carga, y contarlos dos veces inflaría
    // las horas disponibles (y hundiría la ocupación) sin que se note.
    let disponibles = Interval.merge(bloques);

    // Paso 2: restar las ausencias.
    const ausencias = input.timeOff
      .filter((t) => t.doctor === doctorId)
      .map((t) =>
        Interval.fromDateTimes(
          DateTime.fromISO(t.inicio, { zone: timezone }),
          DateTime.fromISO(t.fin, { zone: timezone }),
        ),
      )
      .filter((i) => i.isValid);
    if (ausencias.length > 0) {
      disponibles = disponibles.flatMap((d) => d.difference(...ausencias));
    }

    for (const bloque of disponibles) addToHourBuckets(bloque, buckets, "minutosDisponibles");

    // Paso 3: recortar las citas contra lo disponible.
    const citas = input.appointments.filter((a) => a.doctor === doctorId);
    let minutosOcupados = 0;
    let minutosFuera = 0;
    for (const cita of citas) {
      const intervalo = Interval.fromDateTimes(
        DateTime.fromISO(cita.inicio, { zone: timezone }),
        DateTime.fromISO(cita.fin, { zone: timezone }),
      );
      if (!intervalo.isValid) continue;
      const dentroDelRango = intervalo.intersection(rango);
      if (!dentroDelRango) continue;

      const dentro = disponibles
        .map((d) => dentroDelRango.intersection(d))
        .filter((i): i is Interval => i !== null && i.isValid);
      const minutosDentro = minutes(dentro);
      minutosOcupados += minutosDentro;
      minutosFuera += dentroDelRango.length("minutes") - minutosDentro;
      for (const trozo of dentro) addToHourBuckets(trozo, buckets, "minutosOcupados");
      bucketFor(buckets, dentroDelRango.start!.hour).citas += 1;
    }

    porMedico.push({
      doctorId,
      minutosDisponibles: minutes(disponibles),
      minutosOcupados,
      citas: citas.length,
      minutosFueraDeHorario: minutosFuera,
    });
  }

  const totales = porMedico.reduce(
    (acc, d) => ({
      minutosDisponibles: acc.minutosDisponibles + d.minutosDisponibles,
      minutosOcupados: acc.minutosOcupados + d.minutosOcupados,
      citas: acc.citas + d.citas,
      minutosFueraDeHorario: acc.minutosFueraDeHorario + d.minutosFueraDeHorario,
    }),
    { minutosDisponibles: 0, minutosOcupados: 0, citas: 0, minutosFueraDeHorario: 0 },
  );

  return {
    porMedico: porMedico.sort((a, b) => b.minutosOcupados - a.minutosOcupados),
    porHora: [...buckets.values()].sort((a, b) => a.hora - b.hora),
    totales,
  };
}
