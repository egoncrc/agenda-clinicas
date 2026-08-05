import { createItem, readItems, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus, type ClinicRow, type WaitlistRow } from "../directus.js";
import { config } from "../config.js";
import { matchesPreference, rankCandidates } from "../domain/waitlist.js";
import type { IsoWeekday, WaitlistEntry } from "../domain/types.js";
import { getAvailableSlots } from "./availability.js";
import { bookAppointment, SlotUnavailableError } from "./appointments.js";
import { getPatient } from "./patients.js";
import { getService } from "./services.js";
import { getDoctor } from "./doctors.js";
import { logMessage } from "./messages.js";
import { sendTemplate } from "../whatsapp/ycloud.js";

const TEMPLATE_NAME = "lista_espera_cita_agendada";
const TEMPLATE_LANGUAGE = "es";

/**
 * Se lanza cuando la entrada de lista de espera no existe o no pertenece a
 * ninguno de los pacientes del número que la solicita. Mismo criterio que
 * `AppointmentNotFoundError` en appointments.ts: el token del bot tiene
 * permisos amplios, así que esta verificación de dueño es responsabilidad
 * de este módulo.
 */
export class WaitlistEntryNotFoundError extends Error {
  constructor() {
    super("No encontramos esa entrada de lista de espera asociada a tu número.");
    this.name = "WaitlistEntryNotFoundError";
  }
}

function toEntry(row: WaitlistRow): WaitlistEntry {
  return {
    id: row.id,
    patientId: row.patient,
    serviceId: row.service,
    doctorId: row.doctor ?? null,
    diaSemana: row.dia_semana ?? null,
    horaDesde: row.hora_desde?.slice(0, 5) ?? null,
    horaHasta: row.hora_hasta?.slice(0, 5) ?? null,
    estado: row.estado,
    ofertaInicio: row.oferta_inicio ? new Date(row.oferta_inicio) : null,
    ofertaExpira: row.oferta_expira ? new Date(row.oferta_expira) : null,
    ofertaDoctorId: row.oferta_doctor ?? null,
    appointmentGeneradaId: row.appointment_generada ?? null,
    createdAt: row.date_created ? new Date(row.date_created) : new Date(),
  };
}

export interface AddToWaitlistInput {
  clinicId: string;
  patientId: string;
  serviceId: string;
  /** Si se omite, cualquier odontólogo sirve. */
  doctorId?: string;
  /** Si se omite, cualquier día sirve. */
  diaSemana?: IsoWeekday;
  /** "HH:mm". Si se omite, sin límite inferior. */
  horaDesde?: string;
  /** "HH:mm". Si se omite, sin límite superior. */
  horaHasta?: string;
  notas?: string;
}

/** Anota a un paciente en la lista de espera de un servicio, con preferencia opcional de odontólogo/día/hora. */
export async function addToWaitlist(input: AddToWaitlistInput): Promise<WaitlistEntry> {
  const row = await directus.request(
    createItem("waitlist", {
      clinic: input.clinicId,
      patient: input.patientId,
      service: input.serviceId,
      doctor: input.doctorId ?? null,
      dia_semana: input.diaSemana ?? null,
      hora_desde: input.horaDesde ?? null,
      hora_hasta: input.horaHasta ?? null,
      estado: "activa",
      notas: input.notas ?? null,
    }),
  );
  return toEntry(row);
}

/** Entradas activas o ya agendadas de un conjunto de pacientes (el grupo de un número: titular + familiares). Excluye las canceladas. */
export async function listWaitlistForPatients(patientIds: string[]): Promise<WaitlistEntry[]> {
  if (patientIds.length === 0) return [];
  const rows = await directus.request(
    readItems("waitlist", {
      filter: { patient: { _in: patientIds }, estado: { _in: ["activa", "agendada"] } },
      sort: ["date_created"],
      limit: -1,
    }),
  );
  return rows.map(toEntry);
}

/**
 * Verifica que la entrada exista, pertenezca a la clínica activa y a alguno
 * de los pacientes del número antes de dejar tocarla (el filtro por `clinic`
 * es defensa en profundidad, igual que en appointments.ts).
 */
async function getOwnWaitlistRow(id: string, clinicId: string, allowedPatientIds: string[]): Promise<WaitlistRow> {
  const [row] = await directus.request(
    readItems("waitlist", { filter: { id: { _eq: id }, clinic: { _eq: clinicId } }, limit: 1 }),
  );
  if (!row || !allowedPatientIds.includes(row.patient)) {
    throw new WaitlistEntryNotFoundError();
  }
  return row;
}

/** Da de baja una entrada de lista de espera (el paciente ya no quiere seguir esperando). */
export async function cancelWaitlistEntry(id: string, clinicId: string, allowedPatientIds: string[]): Promise<void> {
  await getOwnWaitlistRow(id, clinicId, allowedPatientIds);
  await directus.request(updateItem("waitlist", id, { estado: "cancelada" }));
}

/**
 * Notifica al paciente que su cita quedó agendada automáticamente (plantilla
 * aprobada, fuera de la ventana de sesión de 24h) y registra el mensaje.
 * Fire-and-forget igual que el resto de envíos salientes del proyecto (ver
 * ycloud.ts): si falla, la cita queda igual agendada — solo el aviso no llega.
 */
async function sendBookedNotification(
  clinic: ClinicRow,
  patientId: string,
  serviceId: string,
  slot: { doctorId: string; inicio: Date },
): Promise<void> {
  const [patient, service, doctor] = await Promise.all([
    getPatient(patientId, clinic.id),
    getService(serviceId, clinic.id),
    getDoctor(slot.doctorId, clinic.id),
  ]);

  const inicio = DateTime.fromJSDate(slot.inicio, { zone: clinic.zona_horaria || config.CLINIC_TIMEZONE }).setLocale("es");
  const fechaHora = inicio.toFormat("cccc d 'de' LLLL, HH:mm");
  const nombrePaciente = patient.nombre ?? "paciente";
  const bodyParams = [
    nombrePaciente,
    service.nombre,
    doctor.nombre,
    fechaHora.split(", ")[0]!,
    fechaHora.split(", ")[1]!,
  ];

  await sendTemplate(patient.telefono, TEMPLATE_NAME, TEMPLATE_LANGUAGE, bodyParams, clinic);
  await logMessage(
    patient.id,
    "out",
    `[lista de espera] Cita agendada automáticamente: ${service.nombre} con ${doctor.nombre} el ${fechaHora}`,
  );
}

export interface WaitlistJobSummary {
  agendadas: number;
}

/**
 * Pasada completa del job de lista de espera para una clínica (disparada por
 * evento al cancelar/reprogramar una cita, o por el barrido periódico de
 * respaldo — ver scheduler.ts, que la corre una vez por cada clínica activa):
 * para cada entrada activa, en orden de prioridad (preferencia más específica
 * primero, luego FIFO), busca el hueco compatible más próximo reutilizando
 * getAvailableSlots (mismo motor de disponibilidad que usa el agente de IA)
 * y, si lo encuentra, agenda la cita directamente (sin pedir confirmación al
 * paciente) y le avisa por WhatsApp.
 *
 * No reserva el cupo atómicamente: dos entradas podrían intentar tomar el
 * mismo hueco en la misma pasada. bookAppointment ya tiene el doble chequeo
 * (Node + hook Directus) y lanza SlotUnavailableError si alguien más lo tomó
 * primero — se loguea y se sigue con la siguiente entrada; esta conserva
 * estado "activa" y se reintenta en la próxima pasada.
 */
export async function runWaitlistMatchingJob(
  clinic: ClinicRow,
  now: DateTime = DateTime.now(),
): Promise<WaitlistJobSummary> {
  const activasRows = await directus.request(
    readItems("waitlist", { filter: { estado: { _eq: "activa" }, clinic: { _eq: clinic.id } }, limit: -1 }),
  );
  const activas = rankCandidates(activasRows.map(toEntry));

  let agendadas = 0;
  const to = now.plus({ days: config.WAITLIST_SEARCH_HORIZON_DAYS });
  for (const entry of activas) {
    try {
      const slots = await getAvailableSlots({
        clinicId: clinic.id,
        serviceId: entry.serviceId,
        doctorId: entry.doctorId ?? undefined,
        from: now,
        to,
      });
      const match = slots.find((s) =>
        matchesPreference(entry, DateTime.fromJSDate(s.inicio, { zone: clinic.zona_horaria || config.CLINIC_TIMEZONE })),
      );
      if (!match) continue;

      let appointment;
      try {
        appointment = await bookAppointment({
          clinicId: clinic.id,
          doctorId: match.doctorId,
          patientId: entry.patientId,
          serviceId: entry.serviceId,
          inicio: match.inicio,
          origen: "lista_espera",
        });
      } catch (err) {
        if (err instanceof SlotUnavailableError) continue;
        throw err;
      }

      await directus.request(
        updateItem("waitlist", entry.id, { estado: "agendada", appointment_generada: appointment.id }),
      );
      await sendBookedNotification(clinic, entry.patientId, entry.serviceId, match);
      agendadas++;
    } catch (err) {
      console.error(`Error agendando automáticamente la entrada de lista de espera ${entry.id} (clínica ${clinic.id}):`, err);
    }
  }

  return { agendadas };
}
