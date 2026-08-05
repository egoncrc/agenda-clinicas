import { createItem, isDirectusError, readItems, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus, type AppointmentRow } from "../directus.js";
import { config } from "../config.js";
import { hasOverlap, overlapsTimeOff } from "../domain/availability.js";
import type { Appointment, AppointmentStatus, TimeOff } from "../domain/types.js";
import { getDoctor } from "./doctors.js";
import { getService } from "./services.js";

/** Estados de cita que ocupan la agenda (ver domain/availability.ts). */
const BLOCKING_STATUSES = ["pendiente", "confirmada", "completada"] as const;

/**
 * Se lanza cuando el hueco propuesto ya no está disponible: lo detecta el
 * chequeo previo en Node (`hasOverlap` contra otras citas, `overlapsTimeOff`
 * contra ausencias del odontólogo) o el hook anti-solapes de Directus
 * (HTTP 403 `FORBIDDEN`), lo que ocurra primero.
 */
export class SlotUnavailableError extends Error {
  constructor() {
    super("El horario solicitado ya no está disponible.");
    this.name = "SlotUnavailableError";
  }
}

/**
 * Se lanza cuando la cita no existe o no pertenece a ninguno de los pacientes
 * del número que la solicita (titular o familiares bajo el mismo teléfono).
 * El token del bot tiene permisos amplios sobre todas las citas (debe poder
 * atender a cualquier paciente), así que esta verificación de dueño es
 * responsabilidad exclusiva de este módulo, no de Directus.
 */
export class AppointmentNotFoundError extends Error {
  constructor() {
    super("No encontramos esa cita asociada a tu número.");
    this.name = "AppointmentNotFoundError";
  }
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

/** Luxon puede devolver `null` para una fecha inválida; aquí siempre partimos de un `Date` real. */
function toIsoString(dt: DateTime): string {
  const iso = dt.toISO();
  if (!iso) throw new Error("Fecha inválida al calcular la cita.");
  return iso;
}

/**
 * Citas activas del odontólogo, en TODAS las clínicas donde trabaje — a
 * propósito: no puede estar en dos sedes a la vez, así que una cita suya en
 * otra clínica también ocupa este hueco. Sin filtro de fecha: el SDK de
 * Directus no tipa bien _gte/_lte sobre campos string, y a esta escala no vale
 * la pena pelear con eso — `hasOverlap` ya ignora las que no se solapan.
 */
async function blockingAppointmentsForDoctor(doctorId: string): Promise<Appointment[]> {
  const rows = await directus.request(
    readItems("appointments", {
      filter: { doctor: { _eq: doctorId }, estado: { _in: [...BLOCKING_STATUSES] } },
      limit: -1,
    }),
  );
  return rows.map(toAppointment);
}

/**
 * Ausencias (time_off) del odontólogo EN esta clínica: una ausencia bloquea
 * solo la agenda de la clínica donde se registró. Mismo patrón de "filtrar en
 * Node" que el resto del módulo.
 */
async function timeOffForDoctor(doctorId: string, clinicId: string): Promise<TimeOff[]> {
  const rows = await directus.request(
    readItems("time_off", {
      filter: { doctor: { _eq: doctorId }, clinic: { _eq: clinicId } },
      limit: -1,
    }),
  );
  return rows.map((t) => ({ doctorId: t.doctor, inicio: new Date(t.inicio), fin: new Date(t.fin) }));
}

export interface BookAppointmentInput {
  clinicId: string;
  doctorId: string;
  patientId: string;
  serviceId: string;
  inicio: Date;
  origen?: string;
}

/**
 * Crea una cita. El control de doble reserva y de ausencias es doble e
 * independiente (ver CLAUDE.md): se verifica aquí con `hasOverlap`/
 * `overlapsTimeOff` antes de escribir, y de nuevo lo aplica el hook de
 * Directus al insertar (que rechaza con 403 si de todos modos hay una
 * condición de carrera).
 */
export async function bookAppointment(input: BookAppointmentInput): Promise<Appointment> {
  // Verifica que el médico trabaje en esta clínica antes que nada: el token del
  // bot ve todas las clínicas, y con médicos multi-clínica un id válido en otra
  // sede llegaría hasta la escritura (lo hacía el link público de reservas).
  await getDoctor(input.doctorId, input.clinicId);
  const service = await getService(input.serviceId, input.clinicId);
  const inicio = DateTime.fromJSDate(input.inicio, { zone: config.CLINIC_TIMEZONE });
  const fin = inicio.plus({ minutes: service.duracionMin });

  const existing = await blockingAppointmentsForDoctor(input.doctorId);
  if (hasOverlap({ inicio: input.inicio, fin: fin.toJSDate() }, existing, service.bufferMin, config.CLINIC_TIMEZONE)) {
    throw new SlotUnavailableError();
  }

  const timeOff = await timeOffForDoctor(input.doctorId, input.clinicId);
  if (overlapsTimeOff({ inicio: input.inicio, fin: fin.toJSDate() }, timeOff, config.CLINIC_TIMEZONE)) {
    throw new SlotUnavailableError();
  }

  try {
    const row = await directus.request(
      createItem("appointments", {
        clinic: input.clinicId,
        doctor: input.doctorId,
        patient: input.patientId,
        service: input.serviceId,
        inicio: toIsoString(inicio),
        fin: toIsoString(fin),
        estado: "pendiente" satisfies AppointmentStatus,
        origen: input.origen ?? "whatsapp",
      }),
    );
    return toAppointment(row);
  } catch (error) {
    if (isDirectusError(error) && error.errors.some((e) => e.extensions.code === "FORBIDDEN")) {
      throw new SlotUnavailableError();
    }
    throw error;
  }
}

/**
 * Citas futuras y activas de un conjunto de pacientes (el grupo de un número:
 * titular + familiares), para "consultar mis citas" o reprogramar/cancelar.
 */
export async function listUpcomingAppointmentsForPatients(patientIds: string[]): Promise<Appointment[]> {
  if (patientIds.length === 0) return [];
  const now = DateTime.now().setZone(config.CLINIC_TIMEZONE);
  const rows = await directus.request(
    readItems("appointments", {
      filter: { patient: { _in: patientIds }, estado: { _in: [...BLOCKING_STATUSES] } },
      sort: ["inicio"],
      limit: -1,
    }),
  );
  return rows.map(toAppointment).filter((a) => a.inicio.getTime() >= now.toMillis());
}

/**
 * Verifica que la cita exista, pertenezca a la clínica activa y a alguno de
 * los pacientes del número antes de dejar tocarla. El filtro por `clinic` es
 * defensa en profundidad: un id de cita de otra clínica nunca debería llegar
 * aquí, pero si lo hiciera (id adivinado/filtrado), no debe resolver.
 */
async function getHouseholdAppointmentRow(
  appointmentId: string,
  clinicId: string,
  allowedPatientIds: string[],
): Promise<AppointmentRow> {
  const [row] = await directus.request(
    readItems("appointments", { filter: { id: { _eq: appointmentId }, clinic: { _eq: clinicId } }, limit: 1 }),
  );
  if (!row || !allowedPatientIds.includes(row.patient)) {
    throw new AppointmentNotFoundError();
  }
  return row;
}

export async function cancelAppointment(
  appointmentId: string,
  clinicId: string,
  allowedPatientIds: string[],
  motivo?: string,
): Promise<void> {
  await getHouseholdAppointmentRow(appointmentId, clinicId, allowedPatientIds);
  // `cancelado_por: "paciente"` explícito: aunque quien ejecuta es el bot, lo que
  // le importa al reporte de cancelaciones es quién la originó, y por este camino
  // siempre es el paciente pidiéndolo por WhatsApp.
  //
  // `cancelado_en` también va explícito aunque `appointment-cancel-stamp-hook` lo
  // estamparía: el bot no debe depender de que esa extensión esté desplegada.
  await directus.request(
    updateItem("appointments", appointmentId, {
      estado: "cancelada" satisfies AppointmentStatus,
      cancelado_en: new Date().toISOString(),
      cancelado_por: "paciente",
      ...(motivo?.trim() ? { motivo_cancelacion: motivo.trim() } : {}),
    }),
  );
}

/**
 * Reprograma: mueve la cita a un nuevo inicio (mismo servicio/doctora/duración).
 * Sujeta a la misma doble validación de solape que `bookAppointment`.
 */
export async function rescheduleAppointment(
  appointmentId: string,
  clinicId: string,
  allowedPatientIds: string[],
  newInicio: Date,
): Promise<Appointment> {
  const existingRow = await getHouseholdAppointmentRow(appointmentId, clinicId, allowedPatientIds);

  const service = await getService(existingRow.service, clinicId);
  const inicio = DateTime.fromJSDate(newInicio, { zone: config.CLINIC_TIMEZONE });
  const fin = inicio.plus({ minutes: service.duracionMin });

  const existing = (await blockingAppointmentsForDoctor(existingRow.doctor)).filter(
    (a) => a.id !== appointmentId,
  );
  if (hasOverlap({ inicio: newInicio, fin: fin.toJSDate() }, existing, service.bufferMin, config.CLINIC_TIMEZONE)) {
    throw new SlotUnavailableError();
  }

  const timeOff = await timeOffForDoctor(existingRow.doctor, clinicId);
  if (overlapsTimeOff({ inicio: newInicio, fin: fin.toJSDate() }, timeOff, config.CLINIC_TIMEZONE)) {
    throw new SlotUnavailableError();
  }

  try {
    const row = await directus.request(
      updateItem("appointments", appointmentId, { inicio: toIsoString(inicio), fin: toIsoString(fin) }),
    );
    return toAppointment(row);
  } catch (error) {
    if (isDirectusError(error) && error.errors.some((e) => e.extensions.code === "FORBIDDEN")) {
      throw new SlotUnavailableError();
    }
    throw error;
  }
}
