/**
 * Tipos de dominio del sistema de agenda.
 * Son independientes de Directus y de WhatsApp: representan las reglas de negocio.
 */

export type AppointmentStatus =
  | "pendiente"
  | "confirmada"
  | "cancelada"
  | "completada"
  | "no_show";

/**
 * Quién originó la cancelación de una cita. Lo deriva el hook
 * `appointment-cancel-stamp-hook` de la accountability de la petición, salvo que
 * el escritor lo mande explícito. Debe coincidir con las opciones del dropdown en
 * scripts/provision-cancellation-fields.ts y con el mirror del panel.
 */
export type CancelledBy =
  | "paciente"
  | "recepcion"
  | "medico"
  | "clinica"
  | "admin";

/** Día de la semana según Luxon/ISO: 1 = lunes ... 7 = domingo. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Especialidad médica (ej. Odontología, Cardiología). */
export interface Specialty {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface Doctor {
  id: string;
  nombre: string;
  activo: boolean;
  /** Especialidad a la que pertenece el médico. */
  specialtyId: string;
}

export interface Service {
  id: string;
  nombre: string;
  /** Duración de la cita en minutos (ej. limpieza 30, endodoncia 60). */
  duracionMin: number;
  /** Tiempo de limpieza/preparación reservado antes y después de cada cita. */
  bufferMin: number;
  activo: boolean;
  /** Especialidad a la que pertenece el servicio. */
  specialtyId: string;
}

/** Bloque de horario laboral de un odontólogo para un día de la semana. */
export interface WorkingHours {
  doctorId: string;
  diaSemana: IsoWeekday;
  /** "HH:mm" en hora local de la clínica. */
  horaInicio: string;
  /** "HH:mm" en hora local de la clínica. */
  horaFin: string;
}

/** Ausencia/bloqueo de agenda (festivo, vacaciones, permiso). */
export interface TimeOff {
  doctorId: string;
  /** Instante de inicio (UTC/ISO). */
  inicio: Date;
  /** Instante de fin (UTC/ISO). */
  fin: Date;
}

/** Cita existente que ocupa la agenda de un odontólogo. */
export interface Appointment {
  id: string;
  doctorId: string;
  patientId: string;
  serviceId: string;
  inicio: Date;
  fin: Date;
  estado: AppointmentStatus;
}

/** Hueco disponible ofrecible a un paciente. */
export interface Slot {
  doctorId: string;
  inicio: Date;
  fin: Date;
}

export type WaitlistStatus = "activa" | "ofrecida" | "agendada" | "cancelada";

/** Preferencia de día/hora de una entrada de lista de espera. Todos los campos son opcionales ("cualquier día", "cualquier hora"). */
export interface WaitlistPreference {
  diaSemana?: IsoWeekday | null;
  /** "HH:mm", límite inferior inclusive. */
  horaDesde?: string | null;
  /** "HH:mm", límite superior inclusive. */
  horaHasta?: string | null;
}

/** Entrada de lista de espera: un paciente esperando una cancelación para un servicio, con preferencia opcional de día/hora/odontólogo. */
export interface WaitlistEntry extends WaitlistPreference {
  id: string;
  patientId: string;
  serviceId: string;
  /** Si se omite, cualquier odontólogo sirve. */
  doctorId?: string | null;
  estado: WaitlistStatus;
  ofertaInicio?: Date | null;
  ofertaExpira?: Date | null;
  /** Odontólogo concreto del hueco ofrecido (puede diferir de `doctorId` cuando la preferencia era "cualquiera"). */
  ofertaDoctorId?: string | null;
  appointmentGeneradaId?: string | null;
  createdAt: Date;
}
