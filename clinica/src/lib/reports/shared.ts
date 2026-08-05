import { aggregate, readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type {
  AppointmentRow,
  AppointmentStatus,
  PatientRow,
  TimeOffRow,
  WorkingHoursRow,
} from "@/lib/directus";
import { dateRangeFilter } from "@/lib/queryHelpers";
import type { ReportFilters, Column } from "./types";

/**
 * Consultas que comparten varios reportes. La regla de cuándo usar cuál:
 *
 * - `aggregate` + `groupBy` cuando basta un conteo por categoría (servicios,
 *   especialidades): el trabajo lo hace Postgres y no viaja una fila por cita.
 * - `readItems` cuando hace falta el detalle fila a fila (cancelaciones,
 *   no-shows, residencia) o cálculo temporal sobre intervalos (ocupación,
 *   productividad), que Directus no sabe agregar.
 *
 * `limit: -1` en todas: sin él Directus corta silenciosamente en 100 filas y el
 * reporte muestra un total plausible pero falso.
 */

/** Estados que ocupan agenda. Mismo criterio que el bot y el guard de solapes. */
export const BLOCKING_STATUSES: AppointmentStatus[] = ["pendiente", "confirmada", "completada"];

/**
 * Filtro base común a todos los reportes.
 *
 * OJO CON EL MÉDICO MULTI-SEDE: la policy `Doctor` de Directus filtra
 * `appointments` por `doctor.usuario` y deliberadamente NO por clínica (el guard
 * de solapes tiene que ser cross-clínica). Si este filtro no llevara `clinic`,
 * un médico que atiende en dos sedes vería los totales mezclados sin saberlo.
 * De ahí que `clinicIds` sea obligatorio y no opcional.
 */
export function baseAppointmentFilter(
  filters: ReportFilters,
  clinicIds: string[],
): Record<string, unknown> {
  const f: Record<string, unknown> = {
    clinic: { _in: clinicIds },
    inicio: dateRangeFilter(filters.desde, filters.hasta),
  };
  if (filters.doctorId) f.doctor = { _eq: filters.doctorId };
  if (filters.serviceId) f.service = { _eq: filters.serviceId };
  return f;
}

export async function fetchAppointments(
  filters: ReportFilters,
  clinicIds: string[],
  estados?: AppointmentStatus[],
): Promise<AppointmentRow[]> {
  const filter = baseAppointmentFilter(filters, clinicIds);
  if (estados?.length) filter.estado = { _in: estados };
  return directus.request(readItems("appointments", { filter, sort: ["inicio"], limit: -1 }));
}

/**
 * Horarios de atención de la(s) sede(s). Son por clínica desde el multi-sede:
 * un médico puede trabajar lunes y martes en una y jueves en otra.
 */
export async function fetchWorkingHours(
  filters: ReportFilters,
  clinicIds: string[],
): Promise<WorkingHoursRow[]> {
  const filter: Record<string, unknown> = { clinic: { _in: clinicIds } };
  if (filters.doctorId) filter.doctor = { _eq: filters.doctorId };
  return directus.request(readItems("working_hours", { filter, limit: -1 }));
}

/**
 * Ausencias que SOLAPAN el rango, no las que empiezan dentro: una vacación de
 * dos semanas iniciada antes del rango igual descuenta horas de agenda.
 * Se compone dentro de un `_and` porque el solape usa dos claves distintas.
 */
export async function fetchTimeOff(
  filters: ReportFilters,
  clinicIds: string[],
): Promise<TimeOffRow[]> {
  const conditions: Record<string, unknown>[] = [
    { clinic: { _in: clinicIds } },
    { inicio: dateRangeFilter(undefined, filters.hasta) },
    { fin: dateRangeFilter(filters.desde, undefined) },
  ];
  if (filters.doctorId) conditions.push({ doctor: { _eq: filters.doctorId } });
  return directus.request(readItems("time_off", { filter: { _and: conditions }, limit: -1 }));
}

/**
 * Pacientes por id, en lotes. Directus mete los ids en la query string de un GET,
 * así que una lista larga revienta el límite de longitud de la URL mucho antes
 * que cualquier límite de la base.
 */
const PATIENT_BATCH = 200;

export async function fetchPatients(ids: string[]): Promise<PatientRow[]> {
  const unique = [...new Set(ids)];
  const out: PatientRow[] = [];
  for (let i = 0; i < unique.length; i += PATIENT_BATCH) {
    const batch = unique.slice(i, i + PATIENT_BATCH);
    const rows = await directus.request(
      readItems("patients", { filter: { id: { _in: batch } }, limit: -1 }),
    );
    out.push(...rows);
  }
  return out;
}

export interface GroupCount {
  key: string | null;
  count: number;
}

/** `aggregate` + `groupBy` sobre `appointments`, que es el único agrupado que usan los reportes. */
export async function countAppointmentsBy(
  field: keyof AppointmentRow & string,
  filter: Record<string, unknown>,
): Promise<GroupCount[]> {
  const result = await directus.request(
    aggregate("appointments", {
      aggregate: { count: "*" },
      groupBy: [field],
      query: { filter },
    }),
  );
  return result.map((row) => {
    const raw = (row as Record<string, unknown>)[field];
    return { key: raw == null ? null : String(raw), count: Number(row.count ?? 0) };
  });
}

/**
 * Fecha de la primera cita histórica de cada paciente de la(s) sede(s).
 *
 * Es lo que permite decidir "paciente nuevo" sin agregar un `patients.date_created`
 * que además sería imposible de backfillear con honestidad. Se agrupa en el
 * servidor: vuelve una fila por paciente, no una por cita, así que recorrer toda
 * la historia sale barato.
 *
 * El `as never` es el mismo hueco de tipado del SDK que documenta queryHelpers.ts:
 * `min` está tipado solo para campos numéricos, pero en Postgres funciona igual
 * sobre un timestamp.
 */
export async function firstAppointmentByPatient(clinicIds: string[]): Promise<Map<string, string>> {
  const result = await directus.request(
    aggregate("appointments", {
      aggregate: { min: "inicio" } as never,
      groupBy: ["patient"],
      query: { filter: { clinic: { _in: clinicIds } } },
    }),
  );
  const map = new Map<string, string>();
  for (const row of result as unknown as { patient?: string; min?: { inicio?: string } }[]) {
    if (row.patient && row.min?.inicio) map.set(String(row.patient), String(row.min.inicio));
  }
  return map;
}

export async function countAppointments(filter: Record<string, unknown>): Promise<number> {
  const result = await directus.request(
    aggregate("appointments", { aggregate: { count: "*" }, query: { filter } }),
  );
  return Number(result[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Utilidades de armado de secciones
// ---------------------------------------------------------------------------

/** Duración de una cita en minutos. Tolera filas con fechas rotas devolviendo 0. */
export function durationMinutes(row: Pick<AppointmentRow, "inicio" | "fin">): number {
  const ms = new Date(row.fin).getTime() - new Date(row.inicio).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 60_000 : 0;
}

/** Divisiones seguras: un denominador 0 devuelve 0, no NaN ni Infinity. */
export function ratio(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

/** Agrupa y cuenta en memoria. El orden de lectura sale de `sortedEntries`, no de acá. */
export function tally<T>(items: T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Alfabético ascendente por nombre de categoría, no por cantidad: es el orden de lectura de toda la sección de Reportes. */
export function sortedEntries(counts: Map<string, number>): [string, number][] {
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
}

/** Columnas de "categoría + cantidad + % del total", que se repiten en media docena de secciones. */
export function rankingColumns(labelColumn: string): Column[] {
  return [
    { key: "label", label: labelColumn },
    { key: "cantidad", label: "Cantidad", align: "right", format: "number" },
    { key: "porcentaje", label: "% del total", align: "right", format: "percent" },
  ];
}

export function rankingRows(counts: Map<string, number>): Record<string, unknown>[] {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return sortedEntries(counts).map(([label, cantidad]) => ({
    label,
    cantidad,
    porcentaje: ratio(cantidad, total),
  }));
}
