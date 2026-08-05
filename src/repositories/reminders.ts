import { readItems, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus, type AppointmentRow, type ClinicRow } from "../directus.js";
import { config } from "../config.js";
import { duesReminders, type ReminderKind } from "../domain/reminders.js";
import { sendTemplate } from "../whatsapp/ycloud.js";
import { logMessage } from "./messages.js";
import { getPatient } from "./patients.js";
import { getService } from "./services.js";
import { getDoctor } from "./doctors.js";

/** Estados de cita que aún ameritan recordatorio (ver BLOCKING_STATUSES en appointments.ts). */
const REMINDABLE_STATUSES = ["pendiente", "confirmada"] as const;

const TEMPLATE_NAME: Record<ReminderKind, string> = {
  "24h": "recordatorio_cita_24h",
  "2h": "recordatorio_cita_2h",
};
const TEMPLATE_LANGUAGE = "es";

const FLAG_FIELD: Record<ReminderKind, "recordatorio_24h_enviado" | "recordatorio_2h_enviado"> = {
  "24h": "recordatorio_24h_enviado",
  "2h": "recordatorio_2h_enviado",
};

interface DueReminder {
  row: AppointmentRow;
  kind: ReminderKind;
}

/**
 * Trae las citas activas de una clínica con al menos un recordatorio
 * pendiente (traído amplio, filtrado en Node — mismo patrón que
 * appointments.ts por la limitación de tipado de fechas del SDK de Directus)
 * y calcula, con el motor puro, cuáles recordatorios corresponde disparar
 * ahora mismo.
 */
export async function findAppointmentsDueForReminder(clinicId: string, now: DateTime): Promise<DueReminder[]> {
  const rows = await directus.request(
    readItems("appointments", {
      filter: {
        clinic: { _eq: clinicId },
        estado: { _in: [...REMINDABLE_STATUSES] },
        _or: [{ recordatorio_24h_enviado: { _eq: false } }, { recordatorio_2h_enviado: { _eq: false } }],
      },
      limit: -1,
    }),
  );

  const due: DueReminder[] = [];
  for (const row of rows) {
    const kinds = duesReminders(
      {
        inicio: new Date(row.inicio),
        recordatorio24hEnviado: row.recordatorio_24h_enviado,
        recordatorio2hEnviado: row.recordatorio_2h_enviado,
      },
      now.toJSDate(),
    );
    for (const kind of kinds) due.push({ row, kind });
  }
  return due;
}

/**
 * Envía el recordatorio (plantilla aprobada) y solo si no lanza, marca el
 * flag correspondiente como enviado. Fire-and-forget: como el resto de envíos
 * salientes en este proyecto (ver sendText en ycloud.ts), no verifica el
 * estado real de entrega — un error de la llamada HTTP se reintenta en la
 * siguiente pasada del scheduler porque el flag no se marcó.
 */
export async function sendReminder(clinic: ClinicRow, row: AppointmentRow, kind: ReminderKind): Promise<void> {
  const [patient, service, doctor] = await Promise.all([
    getPatient(row.patient, clinic.id),
    getService(row.service, clinic.id),
    getDoctor(row.doctor, clinic.id),
  ]);

  const inicio = DateTime.fromISO(row.inicio, { zone: clinic.zona_horaria || config.CLINIC_TIMEZONE }).setLocale("es");
  const fechaHora = inicio.toFormat("cccc d 'de' LLLL, HH:mm");
  const nombrePaciente = patient.nombre ?? "paciente";
  const bodyParams = [nombrePaciente, service.nombre, doctor.nombre, fechaHora];

  await sendTemplate(patient.telefono, TEMPLATE_NAME[kind], TEMPLATE_LANGUAGE, bodyParams, clinic);
  await logMessage(patient.id, "out", `[recordatorio ${kind}] ${bodyParams.join(" | ")}`);
  await directus.request(updateItem("appointments", row.id, { [FLAG_FIELD[kind]]: true }));
}

export interface ReminderJobSummary {
  enviados: number;
  fallidos: number;
}

/** Orquesta una pasada completa para una clínica: un fallo individual no bloquea a los demás. */
export async function runReminderJob(clinic: ClinicRow, now: DateTime = DateTime.now()): Promise<ReminderJobSummary> {
  const due = await findAppointmentsDueForReminder(clinic.id, now);

  let enviados = 0;
  let fallidos = 0;
  for (const { row, kind } of due) {
    try {
      await sendReminder(clinic, row, kind);
      enviados++;
    } catch (err) {
      fallidos++;
      console.error(`Error enviando recordatorio ${kind} de la cita ${row.id} (clínica ${clinic.id}):`, err);
    }
  }
  return { enviados, fallidos };
}
