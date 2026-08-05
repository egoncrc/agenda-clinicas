import { createDirectus, rest, staticToken } from "@directus/sdk";
import { config } from "./config.js";
import type {
  AppointmentStatus,
  CancelledBy,
  IsoWeekday,
  WaitlistStatus,
} from "./domain/types.js";

/**
 * Esquema de colecciones tal como viven en Directus.
 * Las claves foráneas se guardan como el id de la relación (M2O).
 * Fechas/horas se almacenan como ISO string (tipo `timestamp` de Directus).
 */
export interface ClinicRow {
  id: string;
  nombre: string;
  activo: boolean;
  zona_horaria?: string | null;
  whatsapp_numero?: string | null;
  ycloud_api_key?: string | null;
  ycloud_webhook_secret?: string | null;
  booking_public_link_token?: string | null;
}

/** Especialidad médica (ej. Odontología, Cardiología). Acota médicos y servicios. */
export interface SpecialtyRow {
  id: string;
  nombre: string;
  activo: boolean;
  clinic: string;
}

/**
 * Identidad del médico, una fila por persona — la clínica (o clínicas) donde
 * trabaja vive en `clinics_doctors`. Mantener un único `id` por médico es lo
 * que hace que `hasOverlap` y el hook `appointments-overlap-guard` impidan
 * agendarlo a la misma hora en dos clínicas distintas.
 */
export interface DoctorRow {
  id: string;
  nombre: string;
  /** Interruptor global (sincroniza `status` de la cuenta Directus). Para desactivarlo en una sola clínica está `ClinicDoctorRow.activo`. */
  activo: boolean;
  /** Usuario Directus vinculado (login del médico en el panel). Campo manual, opcional. */
  usuario?: string | null;
}

/** Vínculo médico <-> clínica (M2M), con los datos que dependen de la clínica. */
export interface ClinicDoctorRow {
  id: string;
  clinics_id: string;
  doctors_id: string;
  /** Especialidad del médico EN esa clínica (`specialties` es clinic-scoped). */
  specialty: string;
  /** Alta/baja del médico en esa clínica, sin afectar las demás. */
  activo: boolean;
}

export interface ServiceRow {
  id: string;
  nombre: string;
  duracion_min: number;
  buffer_min: number;
  activo: boolean;
  clinic: string;
  /** Especialidad a la que pertenece el servicio (M2O). */
  specialty: string;
  /** Cada cuántos meses conviene repetir el servicio (6 = limpieza semestral). null = no genera recordatorio de seguimiento. */
  recall_meses?: number | null;
}

/** Horario de atención de un médico EN una clínica: el mismo médico puede atender lun-mié en una y jue-vie en otra. */
export interface WorkingHoursRow {
  id: string;
  doctor: string;
  clinic: string;
  dia_semana: IsoWeekday;
  hora_inicio: string; // "HH:mm:ss"
  hora_fin: string;
}

/** Ausencia de un médico EN una clínica: bloquea solo la agenda de esa clínica, no la de las otras donde trabaja. */
export interface TimeOffRow {
  id: string;
  doctor: string;
  clinic: string;
  inicio: string; // ISO
  fin: string; // ISO
  motivo?: string | null;
}

export interface PatientRow {
  id: string;
  telefono: string;
  nombre?: string | null;
  /** Dueño del número (normalmente el adulto). El bot de WhatsApp conversa siempre como el titular; los familiares sin celular propio se registran como no-titulares bajo el mismo teléfono. */
  titular?: boolean;
  notas?: string | null;
  clinic: string;
  /** Ficha que mantiene la recepción desde el panel; el bot no los escribe. */
  identificacion?: string | null;
  correo?: string | null;
  provincia?: string | null;
  canton?: string | null;
  distrito?: string | null;
  direccion?: string | null;
  /** Baja lógica desde el panel (solo administrador). El bot ignora a los inactivos. */
  activo?: boolean;
}

export interface AppointmentRow {
  id: string;
  doctor: string;
  patient: string;
  service: string;
  inicio: string; // ISO
  fin: string; // ISO
  estado: AppointmentStatus;
  origen?: string | null;
  recordatorio_24h_enviado: boolean;
  recordatorio_2h_enviado: boolean;
  /** La recepción ya envió a mano el mensaje de confirmación (panel, pantalla Mensajes). El bot no lo toca. */
  confirmacion_manual_enviada?: boolean | null;
  /** La recepción ya envió a mano el recordatorio de seguimiento derivado de esta cita completada. */
  recall_mensaje_enviado?: boolean | null;
  /** La cancelación la originó una ausencia del médico, no un acuerdo previo con el paciente: hay que avisarle. */
  cancelada_por_ausencia?: boolean | null;
  /** La recepción ya envió a mano el aviso de que la cita fue cancelada por la ausencia. */
  cancelacion_mensaje_enviado?: boolean | null;
  /**
   * Trazabilidad de la cancelación (reporte de cancelaciones del panel). Los tres
   * son null en las citas canceladas antes de scripts/provision-cancellation-fields.ts.
   * `cancelado_en` y `cancelado_por` los estampa el hook appointment-cancel-stamp-hook
   * salvo que el escritor los mande explícitos; el motivo siempre lo aporta el escritor.
   */
  cancelado_en?: string | null; // ISO
  cancelado_por?: CancelledBy | null;
  motivo_cancelacion?: string | null;
  clinic: string;
}

export interface MessageRow {
  id: string;
  patient: string;
  direccion: "in" | "out";
  contenido: string;
  wa_message_id?: string | null;
  date_created?: string;
}

export interface WaitlistRow {
  id: string;
  clinic: string;
  patient: string;
  service: string;
  /** null = cualquier odontólogo. */
  doctor?: string | null;
  /** null = cualquier día. */
  dia_semana?: IsoWeekday | null;
  /** "HH:mm:ss", null = sin límite inferior. */
  hora_desde?: string | null;
  /** "HH:mm:ss", null = sin límite superior. */
  hora_hasta?: string | null;
  estado: WaitlistStatus;
  /** ISO del hueco actualmente ofrecido, mientras estado="ofrecida". */
  oferta_inicio?: string | null;
  /** ISO de cuándo expira la oferta actual. */
  oferta_expira?: string | null;
  /** Odontólogo concreto del hueco ofrecido (puede diferir de `doctor` cuando la preferencia era "cualquiera"). */
  oferta_doctor?: string | null;
  /** Cita resultante, una vez estado="agendada". */
  appointment_generada?: string | null;
  notas?: string | null;
  date_created?: string;
}

export interface Schema {
  clinics: ClinicRow[];
  specialties: SpecialtyRow[];
  doctors: DoctorRow[];
  clinics_doctors: ClinicDoctorRow[];
  services: ServiceRow[];
  working_hours: WorkingHoursRow[];
  time_off: TimeOffRow[];
  patients: PatientRow[];
  appointments: AppointmentRow[];
  messages: MessageRow[];
  waitlist: WaitlistRow[];
}

/**
 * Cliente Directus tipado y autenticado con el token de servicio.
 * Se usa desde el motor de agenda (lectura) y desde los flujos (escritura).
 */
export const directus = createDirectus<Schema>(config.DIRECTUS_URL)
  .with(staticToken(config.DIRECTUS_TOKEN))
  .with(rest());
