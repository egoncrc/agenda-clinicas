import { DateTime } from "luxon";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";

/**
 * Motor de los recordatorios de seguimiento ("recall"): a qué pacientes se les
 * está cumpliendo el plazo desde su última cita completada de un servicio con
 * periodicidad (`services.recall_meses`, ej. limpieza cada 6 meses).
 *
 * Puro y sin I/O, igual que `schedule.ts`: recibe filas y devuelve ítems. La vista
 * se encarga de las consultas a Directus y del texto del mensaje.
 */

/** Cuántos días antes del vencimiento empieza a aparecer el recall en la lista. */
export const RECALL_ANTICIPATION_DAYS = 14;
/** Cuánto tiempo después de vencido se deja de mostrar (y hasta dónde mira la consulta histórica). */
export const RECALL_MAX_OVERDUE_MONTHS = 12;

export interface RecallSourceAppointment {
  id: string;
  patient: string;
  service: string;
  inicio: string; // ISO
  recall_mensaje_enviado?: boolean | null;
}

export interface RecallItem {
  /** Cita completada de origen: es el ancla del updateItem al marcar "Enviado". */
  appointmentId: string;
  patientId: string;
  serviceId: string;
  recallMeses: number;
  /** ISO de la última cita completada de ese servicio. */
  ultimaCitaIso: string;
  /** ISO de cuándo toca volver (última cita + recallMeses). */
  vencimientoIso: string;
  /** Negativo = ya vencido. Sirve para ordenar y para la etiqueta "vence en X días". */
  diasParaVencer: number;
}

export interface ComputeRecallParams {
  /**
   * TODAS las citas `completada` de servicios con recall dentro de la ventana
   * histórica. Importante: sin pre-filtrar por `recall_mensaje_enviado` — ver el
   * comentario del dedupe más abajo.
   */
  completadas: RecallSourceAppointment[];
  /** serviceId -> recall_meses (> 0). Solo los servicios que generan recall. */
  recallMesesByService: Record<string, number>;
  /** Claves `${patientId}::${serviceId}` que ya tienen una cita futura y no necesitan recordatorio. */
  futurasKeys: Set<string>;
  now: DateTime;
  anticipationDays?: number;
  maxOverdueMonths?: number;
}

export function recallKey(patientId: string, serviceId: string): string {
  return `${patientId}::${serviceId}`;
}

export function computeRecallItems(params: ComputeRecallParams): RecallItem[] {
  const {
    completadas,
    recallMesesByService,
    futurasKeys,
    now,
    anticipationDays = RECALL_ANTICIPATION_DAYS,
    maxOverdueMonths = RECALL_MAX_OVERDUE_MONTHS,
  } = params;

  /**
   * Paso 1: quedarse con la cita más reciente de cada par (paciente, servicio).
   *
   * El dedupe va ANTES de descartar por `recall_mensaje_enviado`, y eso es
   * deliberado: si se filtrara por el flag en la consulta, un paciente con una
   * limpieza hace 14 meses (flag en false) y otra hace 7 meses (flag en true,
   * ya contactado) perdería la segunda, la de 14 meses pasaría por "la última" y
   * resucitaría un recordatorio muerto y desfasado.
   */
  const ultimaPorClave = new Map<string, RecallSourceAppointment>();
  for (const row of completadas) {
    const key = recallKey(row.patient, row.service);
    const previa = ultimaPorClave.get(key);
    if (!previa || row.inicio > previa.inicio) ultimaPorClave.set(key, row);
  }

  const items: RecallItem[] = [];

  for (const [key, row] of ultimaPorClave) {
    const meses = recallMesesByService[row.service];
    if (!meses || meses <= 0) continue;
    if (row.recall_mensaje_enviado === true) continue;
    // Ya tiene una cita futura de ese mismo servicio: no hay nada que recordarle.
    if (futurasKeys.has(key)) continue;

    const vencimiento = DateTime.fromISO(row.inicio, { zone: CLINIC_TIMEZONE }).plus({ months: meses });
    if (!vencimiento.isValid) continue;

    // Todavía no toca.
    if (now < vencimiento.minus({ days: anticipationDays })) continue;
    // Demasiado viejo: a estas alturas ya no es un seguimiento, es una recaptación.
    if (vencimiento < now.minus({ months: maxOverdueMonths })) continue;

    items.push({
      appointmentId: row.id,
      patientId: row.patient,
      serviceId: row.service,
      recallMeses: meses,
      ultimaCitaIso: row.inicio,
      vencimientoIso: vencimiento.toISO() ?? row.inicio,
      diasParaVencer: Math.round(vencimiento.diff(now, "days").days),
    });
  }

  // Los más vencidos primero.
  return items.sort((a, b) => a.diasParaVencer - b.diasParaVencer);
}
