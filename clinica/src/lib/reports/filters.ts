import { DateTime } from "luxon";
import {
  CLINIC_TIMEZONE,
  customRange,
  monthRange,
  todayRange,
  toYmd,
  weekRange,
} from "@/lib/dateRanges";
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
  anchor?: DateTime,
): { desde: string; hasta: string } {
  const interval =
    preset === "hoy"
      ? todayRange(anchor)
      : preset === "semana"
        ? weekRange(anchor)
        : preset === "mes"
          ? monthRange(anchor)
          : customRange(desdeYmd, hastaYmd);
  return { desde: interval.start!.toISO()!, hasta: interval.end!.toISO()! };
}

/**
 * Corre el período un paso hacia atrás (-1) o hacia adelante (+1), respetando la
 * unidad del preset: un día, una semana ISO o un mes calendario.
 *
 * El ancla sale de `filters.desde` y no de "hoy": es lo que permite encadenar
 * saltos (tres clics hacia atrás = tres meses atrás). Volver al presente no
 * necesita botón propio — hacer clic en el preset llama a `rangeFromPreset` sin
 * ancla, que siempre re-ancla en hoy.
 *
 * Un rango "Personalizado" no tiene unidad natural que desplazar, así que se
 * devuelve tal cual (la barra de filtros tampoco muestra las flechas ahí).
 */
export function shiftRange(
  filters: ReportFilters,
  direction: -1 | 1,
): { desde: string; hasta: string } {
  if (filters.preset === "personalizado") return { desde: filters.desde, hasta: filters.hasta };

  const actual = DateTime.fromISO(filters.desde, { zone: CLINIC_TIMEZONE });
  if (!actual.isValid) return { desde: filters.desde, hasta: filters.hasta };

  const paso =
    filters.preset === "hoy"
      ? { days: direction }
      : filters.preset === "semana"
        ? { weeks: direction }
        : { months: direction };

  return rangeFromPreset(filters.preset, filters.desde, filters.hasta, actual.plus(paso));
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
