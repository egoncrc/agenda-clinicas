import type { AppointmentStatus } from "@/lib/directus";

/** Único diccionario de etiquetas de estado de cita — usado por la pantalla Citas y por el calendario de Reportes. */
export const ESTADO_LABELS: Record<AppointmentStatus, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
  completada: "Completada",
  no_show: "No se presentó",
};

export const ESTADO_TONE: Record<AppointmentStatus, "success" | "warn" | "danger" | "neutral"> = {
  pendiente: "warn",
  confirmada: "success",
  cancelada: "danger",
  completada: "neutral",
  no_show: "warn",
};
