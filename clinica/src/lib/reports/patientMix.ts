import { DateTime } from "luxon";

/**
 * Clasificación de pacientes nuevos frente a recurrentes, mes a mes. Puro y
 * testeable (`patientMix.test.ts`).
 *
 * NO EXISTE `patients.date_created` en el esquema, y en vez de agregarlo se
 * deriva de las citas: un paciente es NUEVO en el mes M si su PRIMERA cita de
 * toda la historia cae en M. Además de evitar una migración con un backfill
 * imposible (nadie sabe cuándo se dio de alta un paciente cargado hace un año),
 * es la definición que le sirve a la clínica: alguien registrado en enero que
 * recién se atiende en junio es un paciente nuevo de junio, no de enero.
 *
 * Un paciente cuenta UNA vez por mes aunque tenga varias citas en él: se están
 * contando personas, no visitas.
 */

export interface PatientMixInput {
  timezone: string;
  /** Meses del rango en formato "yyyy-LL", en orden cronológico. */
  meses: string[];
  /** patientId -> ISO de su primera cita histórica (agregado en el servidor). */
  primeraCita: Map<string, string>;
  /** Citas del rango consultado. */
  citas: { patient: string; inicio: string }[];
}

export interface MonthMix {
  mes: string;
  nuevos: number;
  recurrentes: number;
}

function claveMes(iso: string, timezone: string): string | null {
  const dt = DateTime.fromISO(iso, { zone: timezone });
  return dt.isValid ? dt.toFormat("yyyy-LL") : null;
}

export function computePatientMix(input: PatientMixInput): MonthMix[] {
  const { timezone } = input;

  // Pacientes distintos con cita en cada mes.
  const pacientesPorMes = new Map<string, Set<string>>();
  for (const cita of input.citas) {
    const mes = claveMes(cita.inicio, timezone);
    if (!mes) continue;
    let set = pacientesPorMes.get(mes);
    if (!set) {
      set = new Set();
      pacientesPorMes.set(mes, set);
    }
    set.add(cita.patient);
  }

  return input.meses.map((mes) => {
    const pacientes = pacientesPorMes.get(mes) ?? new Set<string>();
    let nuevos = 0;
    let recurrentes = 0;
    for (const patient of pacientes) {
      const primera = input.primeraCita.get(patient);
      // Sin primera cita conocida no se puede decidir: se cuenta como recurrente,
      // que es la opción conservadora (no infla el indicador de captación, que es
      // el que se mira para evaluar la publicidad).
      const mesPrimera = primera ? claveMes(primera, timezone) : null;
      if (mesPrimera === mes) nuevos += 1;
      else recurrentes += 1;
    }
    return { mes, nuevos, recurrentes };
  });
}
