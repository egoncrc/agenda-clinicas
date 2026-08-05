import { readItems } from "@directus/sdk";
import { DateTime } from "luxon";
import {
  directus,
  type AppointmentRow,
  type TimeOffRow,
  type WorkingHoursRow,
} from "../directus.js";
import { config } from "../config.js";
import { computeAvailableSlots } from "../domain/availability.js";
import type { Appointment, Slot, TimeOff, WorkingHours } from "../domain/types.js";
import { getDoctor, listActiveDoctors } from "./doctors.js";
import { getService } from "./services.js";

/** Estados de cita que ocupan la agenda (ver domain/availability.ts). */
const BLOCKING_STATUSES = ["pendiente", "confirmada", "completada"] as const;

function toWorkingHours(row: WorkingHoursRow): WorkingHours {
  return {
    doctorId: row.doctor,
    diaSemana: row.dia_semana,
    horaInicio: row.hora_inicio,
    horaFin: row.hora_fin,
  };
}

function toTimeOff(row: TimeOffRow): TimeOff {
  return { doctorId: row.doctor, inicio: new Date(row.inicio), fin: new Date(row.fin) };
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    doctorId: row.doctor,
    patientId: row.patient,
    serviceId: row.service,
    inicio: new Date(row.inicio),
    fin: new Date(row.fin),
    estado: row.estado,
  };
}

export interface AvailabilityQuery {
  clinicId: string;
  serviceId: string;
  /** Si se omite, se busca disponibilidad de todos los médicos activos (acotados por `specialtyId` si se indica). */
  doctorId?: string;
  /** Si se omite `doctorId`, restringe la búsqueda a los médicos de esta especialidad. */
  specialtyId?: string;
  from: DateTime;
  to: DateTime;
  /** Paso entre horas candidatas, en minutos. Por defecto config.SLOT_STEP_MINUTES (el que usa el agente de IA). */
  stepMinutes?: number;
}

/**
 * Disponibilidad real leyendo Directus: trae servicio, horarios, ausencias y
 * citas de cada odontólogo candidato, y delega el cálculo al motor puro
 * (domain/availability.ts). Los huecos de todos los odontólogos se devuelven
 * juntos, ordenados cronológicamente.
 */
export async function getAvailableSlots(query: AvailabilityQuery): Promise<Slot[]> {
  const service = await getService(query.serviceId, query.clinicId);
  const doctors = query.doctorId
    ? [await getDoctor(query.doctorId, query.clinicId)]
    : await listActiveDoctors(query.clinicId, query.specialtyId);

  const now = DateTime.now().setZone(config.CLINIC_TIMEZONE);

  // Se traen todas las ausencias/citas activas del odontólogo (sin acotar por
  // fecha: el SDK de Directus no tipa bien _gte/_lte sobre campos string, y a
  // esta escala no vale la pena pelear con eso). El motor puro ya ignora las
  // que no se solapan con el rango pedido.
  const perDoctor = await Promise.all(
    doctors
      .filter((d) => d.activo)
      .map(async (doctor) => {
        const [whRows, timeOffRows, appointmentRows] = await Promise.all([
          // Horario y ausencias sí se acotan por clínica: un médico que trabaja
          // en varias atiende días distintos en cada una, y una ausencia solo
          // bloquea la clínica donde se registró.
          directus.request(
            readItems("working_hours", {
              filter: { doctor: { _eq: doctor.id }, clinic: { _eq: query.clinicId } },
              limit: -1,
            }),
          ),
          directus.request(
            readItems("time_off", {
              filter: { doctor: { _eq: doctor.id }, clinic: { _eq: query.clinicId } },
              limit: -1,
            }),
          ),
          // Las citas, en cambio, se leen de TODAS las clínicas a propósito: el
          // médico no puede estar en dos sedes a la vez, así que una cita suya
          // en otra clínica también ocupa este hueco.
          directus.request(
            readItems("appointments", {
              filter: {
                doctor: { _eq: doctor.id },
                estado: { _in: [...BLOCKING_STATUSES] },
              },
              limit: -1,
            }),
          ),
        ]);

        return computeAvailableSlots({
          service,
          workingHours: whRows.map(toWorkingHours),
          timeOff: timeOffRows.map(toTimeOff),
          appointments: appointmentRows.map(toAppointment),
          from: query.from,
          to: query.to,
          slotStepMin: query.stepMinutes ?? config.SLOT_STEP_MINUTES,
          now,
          timezone: config.CLINIC_TIMEZONE,
        });
      }),
  );

  return perDoctor.flat().sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}
