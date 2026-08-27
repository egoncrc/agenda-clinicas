import type { AppointmentStatus, CancelledBy } from "@/lib/directus";

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

/**
 * Mismos colores que `Badge.vue` por tono, para pintar un control editable
 * (el `<select>` de estado en la pantalla de Citas) con el aspecto de la
 * insignia que reemplaza — el estado se sigue leyendo de un vistazo.
 */
export const TONE_CONTROL_CLASSES: Record<"success" | "warn" | "danger" | "neutral", string> = {
  success: "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
  neutral: "bg-slate-200 text-slate-600",
};

/**
 * Quién origina una cancelación hecha desde el panel, para el reporte de
 * Cancelaciones: se resuelve por el rol de quien lo está usando — si cancela
 * desde acá, no es el paciente por WhatsApp.
 *
 * Recibe los flags sueltos en vez del store de auth para que este módulo siga
 * siendo puro (sin Pinia) y testeable. Lo usan tanto el modal de edición como
 * el cambio de estado en línea de la tabla, así que no pueden divergir.
 */
export function cancelledByRole(auth: { isAdmin: boolean; isReceptionist: boolean }): CancelledBy {
  if (auth.isAdmin) return "admin";
  if (auth.isReceptionist) return "recepcion";
  return "medico";
}
