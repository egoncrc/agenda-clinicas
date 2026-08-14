import { authentication, createDirectus, rest } from "@directus/sdk";

/**
 * Esquema de colecciones tal como viven en Directus (espejo reducido de
 * src/directus.ts del bot; son dos proyectos desplegables independientes,
 * por eso no se comparte el archivo entre ambos).
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
  telefono_contacto?: string | null;
  /** Link corto de Short.io al formulario público de agendar — lo genera scripts/shorten-booking-links.ts. */
  booking_short_url?: string | null;
}

export interface SpecialtyRow {
  id: string;
  nombre: string;
  activo: boolean;
  clinic: string;
}

/**
 * Identidad del médico, una fila por persona — las clínicas donde trabaja
 * viven en `clinics_doctors`. Un mismo médico puede atender en varias sedes con
 * horario y especialidad distintos en cada una.
 */
export interface DoctorRow {
  id: string;
  nombre: string;
  /** Interruptor global (sincroniza el `status` de su cuenta Directus). Para darlo de baja en una sola clínica está `ClinicDoctorRow.activo`. */
  activo: boolean;
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

/** Médico ya resuelto para una clínica: la identidad aplanada con los datos de su vínculo. Es lo que consumen el catálogo y las pantallas. */
export interface ClinicDoctor {
  id: string;
  nombre: string;
  /** `doctors.activo && clinics_doctors.activo`: atiende de verdad en esta clínica. */
  activo: boolean;
  usuario?: string | null;
  specialty: string;
  /** Id de la fila puente, para editar especialidad/alta-baja en esta clínica. */
  linkId: string;
}

export interface ServiceRow {
  id: string;
  nombre: string;
  duracion_min: number;
  buffer_min: number;
  activo: boolean;
  clinic: string;
  specialty: string;
  /** Cada cuántos meses conviene repetir el servicio (6 = limpieza semestral). Vacío = no genera recordatorio de seguimiento. */
  recall_meses?: number | null;
}

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Horario de atención de un médico EN una clínica: puede atender lun-mié en una sede y jue-vie en otra. */
export interface WorkingHoursRow {
  id: string;
  doctor: string;
  clinic: string;
  dia_semana: IsoWeekday;
  hora_inicio: string; // "HH:mm:ss"
  hora_fin: string;
}

/** Ausencia de un médico EN una clínica: bloquea solo la agenda de esa sede, no la de las otras donde trabaja. */
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
  /** Dueño del número. Varios pacientes pueden compartir un teléfono (ej. un hijo bajo el número del padre); solo uno es titular. */
  titular?: boolean;
  notas?: string | null;
  clinic: string;
  /** Cédula u otro documento. Opcional; el panel valida que no se repita dentro de la clínica. */
  identificacion?: string | null;
  correo?: string | null;
  /** Dirección por División Territorial Administrativa de Costa Rica; se guarda el nombre, no el código. */
  provincia?: string | null;
  canton?: string | null;
  distrito?: string | null;
  /** Señas exactas. */
  direccion?: string | null;
  /** Baja lógica: false = dado de baja. Nunca se borra la fila (arrastraría su historial por ON DELETE CASCADE). */
  activo?: boolean;
}

export type AppointmentStatus = "pendiente" | "confirmada" | "cancelada" | "completada" | "no_show";

/**
 * Quién originó la cancelación. Espejo de `CancelledBy` del bot
 * (src/domain/types.ts) y del dropdown de scripts/provision-cancellation-fields.ts.
 */
export type CancelledBy = "paciente" | "recepcion" | "medico" | "clinica" | "admin";

/** Etiquetas para pantalla y exportaciones. `null` = cita cancelada antes de que existiera el campo. */
export const CANCELLED_BY_LABEL: Record<CancelledBy, string> = {
  paciente: "Paciente",
  recepcion: "Recepción",
  medico: "Médico",
  clinica: "Clínica",
  admin: "Administrador",
};

export interface AppointmentRow {
  id: string;
  clinic: string;
  doctor: string;
  patient: string;
  service: string;
  inicio: string; // ISO
  fin: string; // ISO
  estado: AppointmentStatus;
  origen?: string | null;
  /**
   * Los flags de la pantalla Mensajes. Opcionales y nullable a propósito: las
   * citas creadas antes de que existiera la columna pueden traer `null` en vez de
   * `false`, así que las consultas filtran con `_or` sobre `_eq: false` / `_null`.
   */
  confirmacion_manual_enviada?: boolean | null;
  recall_mensaje_enviado?: boolean | null;
  cancelacion_mensaje_enviado?: boolean | null;
  /**
   * La cancelación la originó una ausencia del médico y no un acuerdo previo con
   * el paciente: es lo que distingue a las citas que hay que avisar de las que la
   * recepción ya habló por teléfono.
   */
  cancelada_por_ausencia?: boolean | null;
  /**
   * Trazabilidad de la cancelación (reporte de Cancelaciones). Nullable igual que
   * los flags de arriba: las citas canceladas antes de
   * scripts/provision-cancellation-fields.ts no tienen el dato y los reportes las
   * muestran como "sin dato" en vez de inventar una anticipación.
   */
  cancelado_en?: string | null; // ISO
  cancelado_por?: CancelledBy | null;
  motivo_cancelacion?: string | null;
}

/**
 * Historial de conversación por paciente. El bot escribe ambas direcciones; el
 * panel solo crea filas `out` desde la pantalla Mensajes, para dejar constancia
 * de lo que la recepción envió a mano.
 */
export interface MessageRow {
  id: string;
  patient: string;
  direccion: "in" | "out";
  contenido: string;
  wa_message_id?: string | null;
  date_created?: string;
}

export type WaitlistStatus = "activa" | "ofrecida" | "agendada" | "cancelada";

export interface WaitlistRow {
  id: string;
  clinic: string;
  patient: string;
  service: string;
  /** null = cualquier médico. */
  doctor?: string | null;
  /** null = cualquier día. */
  dia_semana?: IsoWeekday | null;
  /** "HH:mm:ss", null = sin límite inferior. */
  hora_desde?: string | null;
  /** "HH:mm:ss", null = sin límite superior. */
  hora_hasta?: string | null;
  estado: WaitlistStatus;
  oferta_inicio?: string | null;
  oferta_expira?: string | null;
  oferta_doctor?: string | null;
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

const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_URL as string;

if (!DIRECTUS_URL) {
  throw new Error("Falta VITE_DIRECTUS_URL en la configuración del build.");
}

/**
 * Autenticación por cookie de sesión (no por token en localStorage): el
 * droplet ya tiene SESSION_COOKIE_DOMAIN=.egonia.site configurado en Directus
 * para esto, así que la cookie que pone /auth/login viaja automáticamente a
 * las llamadas REST siguientes sin manejar tokens a mano en el navegador.
 */
export const directus = createDirectus<Schema>(DIRECTUS_URL)
  .with(authentication("session", { credentials: "include" }))
  .with(rest({ credentials: "include" }));
