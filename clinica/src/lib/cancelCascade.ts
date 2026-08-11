/**
 * Cancelación en cascada de las citas que un cambio de agenda deja sin médico:
 * registrar una suspensión (`time_off`) o recortar/borrar un bloque de horario
 * laboral (`working_hours`).
 *
 * Compartido por `TimeOffFormModal` y la pantalla de Horario para que ambos
 * escriban exactamente la misma trazabilidad. Es redundante con los hooks de
 * Directus (`time-off-cascade-hook`, `working-hours-guard`) a propósito: el
 * panel no depende de que esas extensiones estén desplegadas, y los hooks
 * cubren lo que no pasa por el panel (admin de Directus, API). Las dos escrituras
 * son idempotentes, así que da igual quién llegue primero.
 */
import { readItems, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus } from "@/lib/directus";
import type { AppointmentStatus, IsoWeekday } from "@/lib/directus";
import { CLINIC_TIMEZONE, now, toIsoOrThrow } from "@/lib/dateRanges";
import { dateCompareFilter } from "@/lib/queryHelpers";
import { appointmentHitsRemoved } from "@/lib/workingHours";
import type { MinuteRange } from "@/lib/workingHours";

/** Estados que ocupan la agenda y que hay que liberar. `completada` no: esa cita ya se atendió. */
export const CANCELABLE_STATUSES: AppointmentStatus[] = ["pendiente", "confirmada"];

/** Cuántas citas se detallan en el diálogo antes de resumir el resto como "y N más". */
const PREVIEW_LIMIT = 5;

export interface AffectedAppointment {
  id: string;
  inicio: string;
  fin: string;
  patient: string;
}

/**
 * Citas activas y futuras de ese médico en esa clínica. Solo futuras: un cambio
 * registrado a posteriori no debe reescribir citas que ya ocurrieron.
 *
 * Acotado a la clínica porque tanto la suspensión como el horario laboral son
 * por sede: el médico sigue atendiendo en las otras donde trabaje.
 */
export async function fetchFutureActiveAppointments(
  doctor: string,
  clinic: string,
  extraFilters: Record<string, unknown>[] = [],
): Promise<AffectedAppointment[]> {
  return directus.request(
    readItems("appointments", {
      filter: {
        _and: [
          { doctor: { _eq: doctor } },
          { clinic: { _eq: clinic } },
          { estado: { _in: CANCELABLE_STATUSES } },
          { inicio: dateCompareFilter("_gt", toIsoOrThrow(now())) },
          ...extraFilters,
        ],
      },
      fields: ["id", "inicio", "fin", "patient"],
      sort: ["inicio"],
      limit: -1,
    }),
  );
}

/** Texto del diálogo: qué se va a cancelar y qué tiene que hacer la recepción después. */
export async function buildAffectedWarning(
  afectadas: AffectedAppointment[],
  encabezado: string,
): Promise<string> {
  const nombres = await directus.request(
    readItems("patients", {
      filter: { id: { _in: [...new Set(afectadas.map((a) => a.patient))] } },
      fields: ["id", "nombre"],
      limit: -1,
    }),
  );
  const nombrePorId = Object.fromEntries(nombres.map((p) => [p.id, p.nombre?.trim() || "(sin nombre)"]));

  const lineas = afectadas.slice(0, PREVIEW_LIMIT).map((a) => {
    const dt = DateTime.fromISO(a.inicio, { zone: CLINIC_TIMEZONE }).setLocale("es");
    return `• ${dt.toFormat("d LLL, HH:mm")} — ${nombrePorId[a.patient] ?? "(sin nombre)"}`;
  });
  const resto = afectadas.length - lineas.length;
  if (resto > 0) lineas.push(`• y ${resto} más`);

  return [
    encabezado,
    "",
    ...lineas,
    "",
    "Si continúa, esas citas quedarán canceladas. Después habrá que avisar a los pacientes desde la pantalla Mensajes.",
  ].join("\n");
}

/**
 * Marca las citas como canceladas con la trazabilidad que espera el reporte de
 * Cancelaciones y la pestaña "Cancelaciones" de la pantalla Mensajes.
 *
 * `cancelada_por_ausencia` es lo que separa esto de una cancelación que la
 * recepción ya acordó por teléfono: es la señal de "hay que avisar al paciente".
 * El motivo distingue la causa concreta.
 */
export async function cancelAppointments(afectadas: AffectedAppointment[], motivo: string): Promise<void> {
  // El mismo instante para todas: son una sola decisión.
  const canceladoEn = new Date().toISOString();
  for (const a of afectadas) {
    await directus.request(
      updateItem("appointments", a.id, {
        estado: "cancelada",
        cancelada_por_ausencia: true,
        cancelado_en: canceladoEn,
        cancelado_por: "clinica",
        motivo_cancelacion: motivo,
      }),
    );
  }
}

export const MOTIVO_AUSENCIA = "Ausencia del médico";
export const MOTIVO_CAMBIO_HORARIO = "Cambio de horario del médico";

/**
 * Citas que caen en el horario que desaparece (`removedIntervalsByDay`, en
 * `lib/workingHours.ts`).
 *
 * El tramo eliminado lo calcula quien llama, no esta función: la diferencia
 * entre "el cambio no quitó horario" y "quitó horario pero no había ninguna
 * cita ahí" es justo lo que la pantalla necesita distinguir para poder decirlo.
 *
 * El filtrado fino se hace en JS y no en Directus: el criterio es "día de la
 * semana + hora del día", que no se puede expresar como filtro sobre `inicio`.
 * Se trae una sola vez la agenda futura del médico en esa clínica — mismo patrón
 * "consultar amplio y filtrar en código" que usa el bot.
 *
 * Solo se cancela lo que pisa el tramo que DESAPARECE: una cita agendada a mano
 * fuera del horario laboral ya estaba fuera antes del cambio, así que el cambio
 * no la rompe y no se toca.
 */
export async function findAppointmentsInRemoved(
  doctor: string,
  clinic: string,
  removed: Map<IsoWeekday, MinuteRange[]>,
): Promise<AffectedAppointment[]> {
  if (removed.size === 0) return [];
  const futuras = await fetchFutureActiveAppointments(doctor, clinic);
  return futuras.filter((a) => appointmentHitsRemoved(a, removed, CLINIC_TIMEZONE));
}
