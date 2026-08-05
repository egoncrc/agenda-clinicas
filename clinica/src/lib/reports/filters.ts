import { DateTime } from "luxon";
import { customRange, monthRange, todayRange, toYmd, weekRange } from "@/lib/dateRanges";
import type { DatePreset, ReportFilters, ReportRole } from "./types";

/** Rol efectivo para reportes. Espeja la lógica del store de sesión: `admin` sale de `admin_access` y `medico` es el caso por defecto. */
export function resolveRole(isAdmin: boolean, isReceptionist: boolean): ReportRole {
  if (isAdmin) return "admin";
  if (isReceptionist) return "recepcion";
  return "medico";
}

/**
 * Traduce el preset a extremos ISO. Los rangos siempre cubren el día completo:
 * un `<input type="date">` da la fecha pelada, y cortar a medianoche dejaría
 * fuera todas las citas del último día del rango — el clásico "me faltan datos
 * de hoy".
 */
export function rangeFromPreset(
  preset: DatePreset,
  desdeYmd: string,
  hastaYmd: string,
): { desde: string; hasta: string } {
  const interval =
    preset === "hoy"
      ? todayRange()
      : preset === "semana"
        ? weekRange()
        : preset === "mes"
          ? monthRange()
          : customRange(desdeYmd, hastaYmd);
  return { desde: interval.start!.toISO()!, hasta: interval.end!.toISO()! };
}

/** Valores iniciales: el mes en curso, que es el período que la clínica mira por defecto. */
export function defaultFilters(clinicId: string | null, role: ReportRole, ownDoctorId: string | null): ReportFilters {
  const mes = monthRange();
  return {
    ...rangeFromPreset("mes", toYmd(mes.start!), toYmd(mes.end!)),
    preset: "mes",
    clinicId,
    // Un médico se ve siempre a sí mismo. No es la barrera de seguridad (la
    // policy de Directus ya recorta las filas), pero sin fijarlo el selector
    // ofrecería otros médicos y devolvería cero, que se lee como un error.
    doctorId: role === "medico" ? ownDoctorId : null,
    specialtyId: null,
    serviceId: null,
    groupBy: role === "medico" ? "medico" : "especialidad",
  };
}

/** Etiqueta legible del período, para el encabezado del PDF y de la hoja de Excel. */
export function describeRange(filters: ReportFilters): string {
  const desde = DateTime.fromISO(filters.desde).setLocale("es");
  const hasta = DateTime.fromISO(filters.hasta).setLocale("es");
  if (desde.hasSame(hasta, "day")) return desde.toFormat("dd LLLL yyyy");
  return `${desde.toFormat("dd LLL yyyy")} — ${hasta.toFormat("dd LLL yyyy")}`;
}
