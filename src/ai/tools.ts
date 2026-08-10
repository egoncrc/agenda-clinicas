import { DateTime } from "luxon";
import type Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { ClinicRow } from "../directus.js";
import { listActiveDoctors } from "../repositories/doctors.js";
import { listActiveServices } from "../repositories/services.js";
import { listActiveSpecialties } from "../repositories/specialties.js";
import { getAvailableSlots } from "../repositories/availability.js";
import {
  AppointmentNotFoundError,
  bookAppointment,
  cancelAppointment,
  listUpcomingAppointmentsForPatients,
  PatientScheduleConflictError,
  rescheduleAppointment,
  SlotUnavailableError,
} from "../repositories/appointments.js";
import { listPatientsByPhone, resolveOrCreateHouseholdPatient } from "../repositories/patients.js";
import {
  addToWaitlist,
  cancelWaitlistEntry,
  listWaitlistForPatients,
  WaitlistEntryNotFoundError,
} from "../repositories/waitlist.js";
import type { IsoWeekday, WaitlistEntry } from "../domain/types.js";

/**
 * Contexto de la conversación en curso, fijo durante todo el turno del agente.
 * La identidad es el *número* de WhatsApp: `titularId` es el dueño del número
 * (con quien se conversa) y `telefono` permite resolver el grupo de pacientes
 * (titular + familiares) para agendar/consultar/gestionar sus citas.
 * `clinic` es la clínica resuelta a partir del número que recibió el mensaje
 * (ver server.ts) — todo lo que este contexto toca queda aislado a ella.
 */
export interface ToolContext {
  telefono: string;
  titularId: string;
  clinic: ClinicRow;
}

/** Ids de todos los pacientes del número (titular + familiares), dentro de la clínica activa. */
async function householdPatientIds(ctx: ToolContext): Promise<string[]> {
  const group = await listPatientsByPhone(ctx.telefono, ctx.clinic.id);
  return group.map((p) => p.id);
}

export interface ToolDefinition {
  spec: Anthropic.Tool;
  /** Devuelve un resultado serializable a JSON. Los errores de negocio se devuelven como `{ error }`, no se lanzan. */
  handler: (input: never, ctx: ToolContext) => Promise<unknown>;
}

function formatLocal(date: Date, clinic: ClinicRow): string {
  return DateTime.fromJSDate(date, { zone: clinic.zona_horaria || config.CLINIC_TIMEZONE })
    .setLocale("es")
    .toFormat("cccc d 'de' LLLL, HH:mm");
}

async function doctorNameMap(clinicId: string): Promise<Map<string, string>> {
  const doctors = await listActiveDoctors(clinicId);
  return new Map(doctors.map((d) => [d.id, d.nombre]));
}

const listSpecialtiesTool: ToolDefinition = {
  spec: {
    name: "list_specialties",
    description:
      "Lista las especialidades activas que ofrece la clínica (ej. Odontología, Cardiología). Úsalo como primer paso al agendar para saber en qué área necesita el paciente, y así acotar los servicios y médicos. Si la clínica tiene una sola especialidad, no hace falta preguntarla.",
    input_schema: { type: "object", properties: {} },
  },
  handler: async (_input, ctx) => {
    const specialties = await listActiveSpecialties(ctx.clinic.id);
    return specialties.map((s) => ({ id: s.id, nombre: s.nombre }));
  },
};

interface ListServicesInput {
  specialtyId?: string;
}

const listServicesTool: ToolDefinition = {
  spec: {
    name: "list_services",
    description:
      "Lista los servicios activos que ofrece la clínica, con su duración en minutos. Opcionalmente acotados a una especialidad (specialtyId de list_specialties). Úsalo para saber qué servicios existen o confirmar el nombre exacto de uno.",
    input_schema: {
      type: "object",
      properties: {
        specialtyId: { type: "string", description: "id de la especialidad (obtenido de list_specialties) para filtrar los servicios de esa área. Si se omite, se listan todos." },
      },
    },
  },
  handler: async (input: ListServicesInput, ctx) => {
    const services = await listActiveServices(ctx.clinic.id, input.specialtyId);
    return services.map((s) => ({ id: s.id, nombre: s.nombre, duracionMin: s.duracionMin }));
  },
};

interface ListDoctorsInput {
  specialtyId?: string;
}

const listDoctorsTool: ToolDefinition = {
  spec: {
    name: "list_doctors",
    description:
      "Lista los médicos activos de la clínica, opcionalmente acotados a una especialidad (specialtyId de list_specialties). Úsalo si el paciente pregunta quién atiende o pide un médico específico de un área.",
    input_schema: {
      type: "object",
      properties: {
        specialtyId: { type: "string", description: "id de la especialidad (obtenido de list_specialties) para listar solo los médicos de esa área. Si se omite, se listan todos." },
      },
    },
  },
  handler: async (input: ListDoctorsInput, ctx) => {
    const doctors = await listActiveDoctors(ctx.clinic.id, input.specialtyId);
    return doctors.map((d) => ({ id: d.id, nombre: d.nombre, specialtyId: d.specialtyId }));
  },
};

interface CheckAvailabilityInput {
  serviceId: string;
  doctorId?: string;
  specialtyId?: string;
  fromDate: string;
  toDate?: string;
}

const checkAvailabilityTool: ToolDefinition = {
  spec: {
    name: "check_availability",
    description:
      "Consulta los huecos realmente disponibles para un servicio, opcionalmente con un médico específico o acotado a una especialidad, en un rango de fechas. NUNCA inventes horarios: usa siempre esta herramienta antes de ofrecer una hora al paciente.",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "id del servicio (obtenido de list_services)" },
        doctorId: {
          type: "string",
          description: "id del médico (obtenido de list_doctors). Si se omite, se busca con cualquiera de la especialidad indicada.",
        },
        specialtyId: {
          type: "string",
          description: "id de la especialidad (obtenido de list_specialties). Si se omite doctorId, restringe la búsqueda a los médicos de esta especialidad.",
        },
        fromDate: { type: "string", description: "fecha de inicio del rango a consultar, formato YYYY-MM-DD" },
        toDate: {
          type: "string",
          description: "fecha de fin del rango (inclusive), formato YYYY-MM-DD. Si se omite, se usan 6 días desde fromDate.",
        },
      },
      required: ["serviceId", "fromDate"],
    },
  },
  handler: async (input: CheckAvailabilityInput, ctx) => {
    const timezone = ctx.clinic.zona_horaria || config.CLINIC_TIMEZONE;
    const from = DateTime.fromISO(input.fromDate, { zone: timezone });
    if (!from.isValid) return { error: `fromDate inválida: ${input.fromDate}` };
    const to = input.toDate
      ? DateTime.fromISO(input.toDate, { zone: timezone })
      : from.plus({ days: 6 });
    if (!to.isValid) return { error: `toDate inválida: ${input.toDate}` };

    const slots = await getAvailableSlots({
      clinicId: ctx.clinic.id,
      serviceId: input.serviceId,
      doctorId: input.doctorId,
      specialtyId: input.specialtyId,
      from,
      to,
    });

    const names = await doctorNameMap(ctx.clinic.id);
    return slots.slice(0, 20).map((s) => ({
      doctorId: s.doctorId,
      doctorNombre: names.get(s.doctorId) ?? s.doctorId,
      inicio: s.inicio.toISOString(),
      inicioLocal: formatLocal(s.inicio, ctx.clinic),
    }));
  },
};

interface BookAppointmentInput {
  serviceId: string;
  doctorId: string;
  startDateTime: string;
  pacienteNombre?: string;
}

/**
 * Resuelve para qué paciente del número es la cita. Sin `pacienteNombre` es
 * para el titular; con nombre, busca a esa persona entre el grupo (por nombre,
 * sin distinguir mayúsculas) y la crea como familiar si aún no existe.
 * Devuelve `{ error }` si hay varios homónimos y hace falta desambiguar.
 */
async function resolvePatientForBooking(
  ctx: ToolContext,
  pacienteNombre?: string,
): Promise<{ patientId: string } | { error: string }> {
  const nombre = pacienteNombre?.trim();
  if (!nombre) return { patientId: ctx.titularId };

  const { patient, ambiguous } = await resolveOrCreateHouseholdPatient(ctx.telefono, nombre, ctx.clinic.id);
  if (ambiguous) {
    return { error: `Hay varias personas registradas como "${nombre}" en este número; aclara cuál antes de reservar.` };
  }
  return { patientId: patient.id };
}

const bookAppointmentTool: ToolDefinition = {
  spec: {
    name: "book_appointment",
    description:
      "Reserva una cita. Por defecto es para el titular del número; si la cita es para un familiar (ej. un hijo sin celular propio), pasa su nombre en pacienteNombre y se registrará bajo el mismo número si aún no existe. Solo llama esto después de haber confirmado explícitamente con el paciente el servicio, odontólogo, horario y para quién es la cita, y de haber verificado el horario con check_availability.",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        doctorId: { type: "string" },
        startDateTime: { type: "string", description: "instante de inicio en ISO 8601, ej. 2026-07-14T09:00:00-05:00" },
        pacienteNombre: {
          type: "string",
          description:
            "Nombre de la persona para quien es la cita, SOLO si NO es el titular (ej. un familiar). Omítelo si la cita es para el titular del número.",
        },
      },
      required: ["serviceId", "doctorId", "startDateTime"],
    },
  },
  handler: async (input: BookAppointmentInput, ctx) => {
    const timezone = ctx.clinic.zona_horaria || config.CLINIC_TIMEZONE;
    const start = DateTime.fromISO(input.startDateTime, { zone: timezone });
    if (!start.isValid) return { error: `startDateTime inválida: ${input.startDateTime}` };

    const resolved = await resolvePatientForBooking(ctx, input.pacienteNombre);
    if ("error" in resolved) return { error: resolved.error };

    try {
      const appointment = await bookAppointment({
        clinicId: ctx.clinic.id,
        doctorId: input.doctorId,
        patientId: resolved.patientId,
        serviceId: input.serviceId,
        inicio: start.toJSDate(),
      });
      return {
        appointmentId: appointment.id,
        inicioLocal: formatLocal(appointment.inicio, ctx.clinic),
        estado: appointment.estado,
      };
    } catch (error) {
      if (error instanceof SlotUnavailableError || error instanceof PatientScheduleConflictError) {
        return { error: error.message };
      }
      throw error;
    }
  },
};

const getMyAppointmentsTool: ToolDefinition = {
  spec: {
    name: "get_my_appointments",
    description:
      "Lista las próximas citas activas (pendientes o confirmadas) de todas las personas registradas bajo este número (el titular y sus familiares). Cada cita incluye el nombre del paciente al que pertenece.",
    input_schema: { type: "object", properties: {} },
  },
  handler: async (_input, ctx) => {
    const group = await listPatientsByPhone(ctx.telefono, ctx.clinic.id);
    const patientName = new Map(
      group.map((p) => [p.id, p.nombre?.trim() || (p.titular ? "titular" : "familiar")]),
    );
    const appointments = await listUpcomingAppointmentsForPatients(group.map((p) => p.id));
    const names = await doctorNameMap(ctx.clinic.id);
    return appointments.map((a) => ({
      appointmentId: a.id,
      pacienteNombre: patientName.get(a.patientId) ?? "paciente",
      doctorNombre: names.get(a.doctorId) ?? a.doctorId,
      inicioLocal: formatLocal(a.inicio, ctx.clinic),
      estado: a.estado,
    }));
  },
};

interface RescheduleAppointmentInput {
  appointmentId: string;
  newStartDateTime: string;
}

const rescheduleAppointmentTool: ToolDefinition = {
  spec: {
    name: "reschedule_appointment",
    description:
      "Cambia el horario de una cita existente (del titular o de un familiar bajo este número) a uno nuevo, ya confirmado con el paciente y verificado con check_availability.",
    input_schema: {
      type: "object",
      properties: {
        appointmentId: { type: "string" },
        newStartDateTime: { type: "string", description: "nuevo instante de inicio en ISO 8601" },
      },
      required: ["appointmentId", "newStartDateTime"],
    },
  },
  handler: async (input: RescheduleAppointmentInput, ctx) => {
    const timezone = ctx.clinic.zona_horaria || config.CLINIC_TIMEZONE;
    const start = DateTime.fromISO(input.newStartDateTime, { zone: timezone });
    if (!start.isValid) return { error: `newStartDateTime inválida: ${input.newStartDateTime}` };

    try {
      const ids = await householdPatientIds(ctx);
      const appointment = await rescheduleAppointment(input.appointmentId, ctx.clinic.id, ids, start.toJSDate());
      return { appointmentId: appointment.id, inicioLocal: formatLocal(appointment.inicio, ctx.clinic) };
    } catch (error) {
      if (
        error instanceof SlotUnavailableError ||
        error instanceof AppointmentNotFoundError ||
        error instanceof PatientScheduleConflictError
      ) {
        return { error: error.message };
      }
      throw error;
    }
  },
};

interface CancelAppointmentInput {
  appointmentId: string;
  motivo?: string;
}

const cancelAppointmentTool: ToolDefinition = {
  spec: {
    name: "cancel_appointment",
    description:
      "Cancela una cita (del titular o de un familiar bajo este número), tras confirmar explícitamente con el paciente que desea cancelar esa cita en particular.",
    input_schema: {
      type: "object",
      properties: {
        appointmentId: { type: "string" },
        // Opcional a propósito: no hay que interrogar al paciente. Solo se manda
        // si él mismo dijo por qué, para el reporte de cancelaciones del panel.
        motivo: {
          type: "string",
          description:
            "Motivo de la cancelación, si el paciente lo mencionó espontáneamente. No preguntarlo si no lo dice.",
        },
      },
      required: ["appointmentId"],
    },
  },
  handler: async (input: CancelAppointmentInput, ctx) => {
    try {
      const ids = await householdPatientIds(ctx);
      await cancelAppointment(input.appointmentId, ctx.clinic.id, ids, input.motivo);
      return { ok: true };
    } catch (error) {
      if (error instanceof AppointmentNotFoundError) return { error: error.message };
      throw error;
    }
  },
};

const DIA_NOMBRES: Record<IsoWeekday, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
  7: "domingo",
};

/** Describe la preferencia de una entrada de lista de espera en texto legible ("sábados", "después de las 15:00", "cualquier día/hora"). */
function describePreference(entry: Pick<WaitlistEntry, "diaSemana" | "horaDesde" | "horaHasta">): string {
  const parts: string[] = [];
  parts.push(entry.diaSemana != null ? DIA_NOMBRES[entry.diaSemana] : "cualquier día");
  if (entry.horaDesde && entry.horaHasta) parts.push(`entre las ${entry.horaDesde} y las ${entry.horaHasta}`);
  else if (entry.horaDesde) parts.push(`después de las ${entry.horaDesde}`);
  else if (entry.horaHasta) parts.push(`antes de las ${entry.horaHasta}`);
  else parts.push("cualquier hora");
  return parts.join(", ");
}

interface JoinWaitlistInput {
  serviceId: string;
  doctorId?: string;
  diaSemana?: IsoWeekday;
  horaDesde?: string;
  horaHasta?: string;
  pacienteNombre?: string;
  notas?: string;
}

const joinWaitlistTool: ToolDefinition = {
  spec: {
    name: "join_waitlist",
    description:
      "Anota al paciente en la lista de espera de un servicio: si se libera un cupo compatible con su preferencia (ej. 'cualquier hora un sábado', 'cualquier día después de las 15:00', o ambas cosas), el sistema le agenda la cita automáticamente (sin volver a preguntarle) y le avisa por WhatsApp. Todas las preferencias son opcionales: si se omiten, sirve cualquier hueco. Solo llama esto tras confirmar con el paciente el servicio y su preferencia (si tiene alguna).",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        doctorId: { type: "string", description: "Opcional: si el paciente solo quiere esperar por un odontólogo específico." },
        diaSemana: { type: "integer", minimum: 1, maximum: 7, description: "1=lunes ... 7=domingo. Omite si no importa el día." },
        horaDesde: { type: "string", description: "Hora mínima, formato HH:mm. Omite si no hay límite inferior." },
        horaHasta: { type: "string", description: "Hora máxima, formato HH:mm. Omite si no hay límite superior." },
        pacienteNombre: {
          type: "string",
          description: "Nombre de la persona para quien es, SOLO si NO es el titular. Omítelo si es para el titular del número.",
        },
        notas: { type: "string", description: "Cualquier detalle adicional relevante que mencione el paciente." },
      },
      required: ["serviceId"],
    },
  },
  handler: async (input: JoinWaitlistInput, ctx) => {
    const resolved = await resolvePatientForBooking(ctx, input.pacienteNombre);
    if ("error" in resolved) return { error: resolved.error };

    const entry = await addToWaitlist({
      clinicId: ctx.clinic.id,
      patientId: resolved.patientId,
      serviceId: input.serviceId,
      doctorId: input.doctorId,
      diaSemana: input.diaSemana,
      horaDesde: input.horaDesde,
      horaHasta: input.horaHasta,
      notas: input.notas,
    });
    return { waitlistEntryId: entry.id, preferencia: describePreference(entry) };
  },
};

const listMyWaitlistEntriesTool: ToolDefinition = {
  spec: {
    name: "list_my_waitlist_entries",
    description:
      "Lista las entradas de lista de espera (activas o ya agendadas) de todas las personas registradas bajo este número. Úsalo si el paciente pregunta en qué listas de espera está o si ya le agendaron algo.",
    input_schema: { type: "object", properties: {} },
  },
  handler: async (_input, ctx) => {
    const ids = await householdPatientIds(ctx);
    const entries = await listWaitlistForPatients(ids);
    const [services, doctors] = await Promise.all([listActiveServices(ctx.clinic.id), doctorNameMap(ctx.clinic.id)]);
    const serviceName = new Map(services.map((s) => [s.id, s.nombre]));
    return entries.map((e) => ({
      waitlistEntryId: e.id,
      servicio: serviceName.get(e.serviceId) ?? e.serviceId,
      doctora: e.doctorId ? doctors.get(e.doctorId) ?? e.doctorId : "cualquiera",
      preferencia: describePreference(e),
      estado: e.estado,
      citaAgendadaId: e.estado === "agendada" ? e.appointmentGeneradaId : undefined,
    }));
  },
};

interface LeaveWaitlistInput {
  waitlistEntryId: string;
}

const leaveWaitlistTool: ToolDefinition = {
  spec: {
    name: "leave_waitlist",
    description: "Da de baja una entrada de lista de espera (el paciente ya no quiere seguir esperando ese cupo), tras confirmar explícitamente con él.",
    input_schema: {
      type: "object",
      properties: { waitlistEntryId: { type: "string" } },
      required: ["waitlistEntryId"],
    },
  },
  handler: async (input: LeaveWaitlistInput, ctx) => {
    try {
      const ids = await householdPatientIds(ctx);
      await cancelWaitlistEntry(input.waitlistEntryId, ctx.clinic.id, ids);
      return { ok: true };
    } catch (error) {
      if (error instanceof WaitlistEntryNotFoundError) return { error: error.message };
      throw error;
    }
  },
};

interface HandoffToHumanInput {
  reason: string;
}

const handoffToHumanTool: ToolDefinition = {
  spec: {
    name: "handoff_to_human",
    description:
      "Deriva la conversación a un miembro del equipo humano de la clínica cuando no puedas resolver la solicitud del paciente (queja, urgencia médica, algo fuera de agendar/consultar/cancelar citas).",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "motivo breve de la derivación" } },
      required: ["reason"],
    },
  },
  handler: async (input: HandoffToHumanInput) => {
    return { ok: true, reason: input.reason };
  },
};

export const tools: ToolDefinition[] = [
  listSpecialtiesTool,
  listServicesTool,
  listDoctorsTool,
  checkAvailabilityTool,
  bookAppointmentTool,
  getMyAppointmentsTool,
  rescheduleAppointmentTool,
  cancelAppointmentTool,
  joinWaitlistTool,
  listMyWaitlistEntriesTool,
  leaveWaitlistTool,
  handoffToHumanTool,
];

export const toolSpecs: Anthropic.Tool[] = tools.map((t) => t.spec);

const toolsByName = new Map(tools.map((t) => [t.spec.name, t]));

export function getToolHandler(name: string): ToolDefinition["handler"] | undefined {
  return toolsByName.get(name)?.handler;
}
