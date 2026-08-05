import { aggregate, readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { AppointmentStatus } from "@/lib/directus";
import { dateRangeFilter } from "@/lib/queryHelpers";
import { todayRange, weekRange } from "@/lib/dateRanges";

async function countAppointments(
  clinicId: string,
  estado: AppointmentStatus | AppointmentStatus[],
  fromIso: string,
  toIso: string,
): Promise<number> {
  const result = await directus.request(
    aggregate("appointments", {
      aggregate: { count: "*" },
      query: {
        filter: {
          clinic: { _eq: clinicId },
          estado: Array.isArray(estado) ? { _in: estado } : { _eq: estado },
          inicio: dateRangeFilter(fromIso, toIso),
        },
      },
    }),
  );
  return Number(result[0]?.count ?? 0);
}

export interface DoctorBreakdown {
  doctorId: string;
  count: number;
}

async function countByDoctorToday(clinicId: string): Promise<DoctorBreakdown[]> {
  const today = todayRange();
  const result = await directus.request(
    aggregate("appointments", {
      aggregate: { count: "*" },
      groupBy: ["doctor"],
      query: {
        filter: {
          clinic: { _eq: clinicId },
          estado: { _in: ["pendiente", "confirmada"] satisfies AppointmentStatus[] },
          inicio: dateRangeFilter(today.start!.toISO()!, today.end!.toISO()!),
        },
      },
    }),
  );
  return result.map((row) => ({ doctorId: String(row.doctor), count: Number(row.count ?? 0) }));
}

export interface UpcomingAppointmentRow {
  id: string;
  inicio: Date;
  estado: AppointmentStatus;
  doctorId: string;
  serviceId: string;
  patientId: string;
}

async function upcomingAppointments(clinicId: string, limit: number): Promise<UpcomingAppointmentRow[]> {
  const rows = await directus.request(
    readItems("appointments", {
      filter: {
        clinic: { _eq: clinicId },
        estado: { _in: ["pendiente", "confirmada"] satisfies AppointmentStatus[] },
        inicio: dateRangeFilter(new Date().toISOString(), undefined),
      },
      sort: ["inicio"],
      limit,
    }),
  );
  return rows.map((r) => ({
    id: r.id,
    inicio: new Date(r.inicio),
    estado: r.estado,
    doctorId: r.doctor,
    serviceId: r.service,
    patientId: r.patient,
  }));
}

export interface DashboardStats {
  confirmadasHoy: number;
  pendientesHoy: number;
  canceladasHoy: number;
  canceladasSemana: number;
  noShowsSemana: number;
  porDoctoraHoy: DoctorBreakdown[];
  proximasCitas: UpcomingAppointmentRow[];
}

export async function fetchDashboardStats(clinicId: string): Promise<DashboardStats> {
  const today = todayRange();
  const week = weekRange();
  const todayFrom = today.start!.toISO()!;
  const todayTo = today.end!.toISO()!;
  const weekFrom = week.start!.toISO()!;
  const weekTo = week.end!.toISO()!;

  const [
    confirmadasHoy,
    pendientesHoy,
    canceladasHoy,
    canceladasSemana,
    noShowsSemana,
    porDoctoraHoy,
    proximasCitas,
  ] = await Promise.all([
    countAppointments(clinicId, "confirmada", todayFrom, todayTo),
    countAppointments(clinicId, "pendiente", todayFrom, todayTo),
    countAppointments(clinicId, "cancelada", todayFrom, todayTo),
    countAppointments(clinicId, "cancelada", weekFrom, weekTo),
    countAppointments(clinicId, "no_show", weekFrom, weekTo),
    countByDoctorToday(clinicId),
    upcomingAppointments(clinicId, 5),
  ]);

  return {
    confirmadasHoy,
    pendientesHoy,
    canceladasHoy,
    canceladasSemana,
    noShowsSemana,
    porDoctoraHoy,
    proximasCitas,
  };
}
