/**
 * Reglas puras del horario laboral de un médico. Sin I/O: recibe filas de
 * `working_hours` y devuelve minutos, para poder testearlo sin Directus.
 *
 * Todo se trabaja en minutos desde medianoche y con intervalos semiabiertos
 * `[inicio, fin)`. Eso es lo que hace que dos bloques contiguos (08:00–11:00 y
 * 11:00–13:00) NO cuenten como superpuestos, que es exactamente como la clínica
 * parte una jornada larga en dos tramos.
 */
import { DateTime } from "luxon";
import type { IsoWeekday } from "@/lib/directus";

/** Tramo de un día, en minutos desde medianoche. Semiabierto: `[inicio, fin)`. */
export interface MinuteRange {
  inicio: number;
  fin: number;
}

/** Lo mínimo que necesita este módulo de una fila de `working_hours`. */
export interface HoursBlock {
  dia_semana: IsoWeekday;
  hora_inicio: string;
  hora_fin: string;
}

/**
 * Qué pasó al guardar un cambio de horario. `quitoHorario` no se deduce de
 * `canceladas`: un cambio puede dejar horario sin cubrir y no afectar a nadie,
 * y decirlo es lo que distingue "se revisó y no había citas" de "no se revisó".
 */
export interface ScheduleChangeResult {
  canceladas: number;
  quitoHorario: boolean;
}

/**
 * Acepta tanto `"HH:mm"` (lo que produce el formulario) como `"HH:mm:ss"` (lo
 * que devuelve Directus para un campo `time`) — mismo criterio permisivo que
 * `parseHhMm` en el motor del bot (src/domain/availability.ts).
 */
export function hhmmToMin(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

export function minToHhmm(value: number): string {
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toRange(block: HoursBlock): MinuteRange | null {
  const inicio = hhmmToMin(block.hora_inicio);
  const fin = hhmmToMin(block.hora_fin);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return null;
  return { inicio, fin };
}

/** Unión normalizada: ordenada, sin solapes y con los tramos contiguos fundidos. */
export function mergeRanges(ranges: MinuteRange[]): MinuteRange[] {
  const ordenados = [...ranges].filter((r) => r.fin > r.inicio).sort((a, b) => a.inicio - b.inicio);
  const out: MinuteRange[] = [];
  for (const r of ordenados) {
    const last = out[out.length - 1];
    if (last && r.inicio <= last.fin) {
      last.fin = Math.max(last.fin, r.fin);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** `before` menos `after`: los tramos que quedan sin cubrir tras el cambio. */
export function subtractRanges(before: MinuteRange[], after: MinuteRange[]): MinuteRange[] {
  const restar = mergeRanges(after);
  const out: MinuteRange[] = [];
  for (const base of mergeRanges(before)) {
    let cursor = base.inicio;
    for (const r of restar) {
      if (r.fin <= cursor) continue;
      if (r.inicio >= base.fin) break;
      if (r.inicio > cursor) out.push({ inicio: cursor, fin: Math.min(r.inicio, base.fin) });
      cursor = Math.max(cursor, r.fin);
      if (cursor >= base.fin) break;
    }
    if (cursor < base.fin) out.push({ inicio: cursor, fin: base.fin });
  }
  return out;
}

/** Unión de los tramos de cada día de la semana. */
function unionByDay(blocks: HoursBlock[]): Map<IsoWeekday, MinuteRange[]> {
  const porDia = new Map<IsoWeekday, MinuteRange[]>();
  for (const b of blocks) {
    const r = toRange(b);
    if (!r) continue;
    const acc = porDia.get(b.dia_semana);
    if (acc) acc.push(r);
    else porDia.set(b.dia_semana, [r]);
  }
  for (const [dia, ranges] of porDia) porDia.set(dia, mergeRanges(ranges));
  return porDia;
}

/**
 * Horario que DEJA de estar cubierto al pasar de `before` a `after`, día por día.
 *
 * Es la diferencia entre las dos uniones, no una comparación bloque a bloque: si
 * el lunes hay 08–11 y 11–13 y se borra el primero, desaparece 08–11 y nada más;
 * y si dos bloques ya venían solapados (datos viejos, hoy nada lo impedía), la
 * unión evita contar el mismo tramo dos veces. Ampliar un bloque no elimina nada
 * y devuelve un mapa vacío.
 *
 * Solo aparecen días con algo que se pierde: un día sin cambios no entra al mapa.
 */
export function removedIntervalsByDay(
  before: HoursBlock[],
  after: HoursBlock[],
): Map<IsoWeekday, MinuteRange[]> {
  const antes = unionByDay(before);
  const despues = unionByDay(after);
  const out = new Map<IsoWeekday, MinuteRange[]>();
  for (const [dia, ranges] of antes) {
    const eliminados = subtractRanges(ranges, despues.get(dia) ?? []);
    if (eliminados.length > 0) out.set(dia, eliminados);
  }
  return out;
}

/**
 * Primer bloque de `siblings` que se superpone con `candidate` (mismo día), o
 * `null`. Contiguos no cuentan: el intervalo es semiabierto.
 *
 * Quien llama es responsable de excluir la propia fila al editar y de acotar la
 * lista al médico correspondiente.
 */
export function overlappingBlock<T extends HoursBlock>(candidate: HoursBlock, siblings: T[]): T | null {
  const c = toRange(candidate);
  if (!c) return null;
  for (const s of siblings) {
    if (s.dia_semana !== candidate.dia_semana) continue;
    const r = toRange(s);
    if (!r) continue;
    if (c.inicio < r.fin && r.inicio < c.fin) return s;
  }
  return null;
}

/**
 * ¿La cita pisa alguno de los tramos que desaparecen?
 *
 * Se resuelve el día de la semana y la hora en la zona de la clínica, que es la
 * que usan los campos `hora_inicio`/`hora_fin` (no tienen zona propia). Un
 * solape parcial cuenta; empezar justo donde termina el tramo eliminado, no.
 *
 * Una cita que cruzara la medianoche se recorta al final del día de `inicio`:
 * el horario laboral no puede describir el tramo del día siguiente, así que no
 * hay nada que comparar ahí.
 */
export function appointmentHitsRemoved(
  appointment: { inicio: string; fin: string },
  removed: Map<IsoWeekday, MinuteRange[]>,
  timezone: string,
): boolean {
  const inicio = DateTime.fromISO(appointment.inicio, { zone: timezone });
  const fin = DateTime.fromISO(appointment.fin, { zone: timezone });
  if (!inicio.isValid || !fin.isValid) return false;

  const ranges = removed.get(inicio.weekday as IsoWeekday);
  if (!ranges || ranges.length === 0) return false;

  const desde = inicio.hour * 60 + inicio.minute;
  const cruzaMedianoche = !fin.hasSame(inicio, "day");
  const hasta = cruzaMedianoche ? 24 * 60 : fin.hour * 60 + fin.minute;
  if (hasta <= desde) return false;

  return ranges.some((r) => desde < r.fin && r.inicio < hasta);
}

/** Los mismos tramos, en texto ("08:00–09:00, 11:30–12:00"), para el diálogo de confirmación. */
export function describeRemoved(removed: Map<IsoWeekday, MinuteRange[]>): string {
  const DIAS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  return [...removed.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dia, ranges]) => `${DIAS[dia]} ${ranges.map((r) => `${minToHhmm(r.inicio)}–${minToHhmm(r.fin)}`).join(", ")}`)
    .join("; ");
}
