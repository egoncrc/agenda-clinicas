import { DateTime, Interval } from "luxon";
import { CLINIC_TIMEZONE, eachMonth, formatMonth } from "@/lib/dateRanges";
import { computePatientMix } from "../patientMix";
import { fetchAppointments, firstAppointmentByPatient, ratio } from "../shared";
import type { ReportContext, ReportDefinition } from "../types";

export const patientMixReport: ReportDefinition = {
  id: "pacientes-nuevos-recurrentes",
  title: "Pacientes nuevos vs recurrentes",
  description:
    "Cuántas personas distintas se atendieron cada mes y cuántas de ellas venían por primera vez.",
  icon: "users",
  roles: ["admin", "recepcion", "medico"],
  filters: ["rango", "clinicId", "doctorId", "specialtyId"],

  async run(filters, ctx: ReportContext) {
    const [citas, primeraCita] = await Promise.all([
      fetchAppointments(filters, ctx.clinicIds),
      firstAppointmentByPatient(ctx.clinicIds),
    ]);

    const filtradas = filters.specialtyId
      ? citas.filter((a) => ctx.specialtyOfService(a.service) === filters.specialtyId)
      : citas;

    const rango = Interval.fromDateTimes(
      DateTime.fromISO(filters.desde, { zone: CLINIC_TIMEZONE }),
      DateTime.fromISO(filters.hasta, { zone: CLINIC_TIMEZONE }),
    );
    const meses = eachMonth(rango);

    const mix = computePatientMix({
      timezone: CLINIC_TIMEZONE,
      meses: meses.map((m) => m.toFormat("yyyy-LL")),
      primeraCita,
      citas: filtradas,
    });

    // Excepción deliberada a la regla de orden alfabético del resto de Reportes:
    // esto es un eje temporal, no una lista de categorías. `meses` ya viene
    // cronológico de `eachMonth`, y alfabetizar los nombres de mes ("agosto"
    // antes que "enero") destruiría la línea de tendencia sin ganar nada.
    const etiqueta = new Map(meses.map((m) => [m.toFormat("yyyy-LL"), formatMonth(m)]));
    const rows = mix.map((m) => ({
      mes: etiqueta.get(m.mes) ?? m.mes,
      nuevos: m.nuevos,
      recurrentes: m.recurrentes,
      total: m.nuevos + m.recurrentes,
      // El porcentaje de captación es lo que se mira para evaluar publicidad y
      // referidos; el conteo crudo sube y baja solo por el volumen del mes.
      captacion: ratio(m.nuevos, m.nuevos + m.recurrentes),
    }));

    const totalNuevos = mix.reduce((a, m) => a + m.nuevos, 0);
    const totalRecurrentes = mix.reduce((a, m) => a + m.recurrentes, 0);

    return {
      kpis: [
        { label: "Pacientes nuevos", value: String(totalNuevos), tone: "success" },
        { label: "Pacientes recurrentes", value: String(totalRecurrentes) },
        {
          label: "Captación",
          value: `${Math.round(ratio(totalNuevos, totalNuevos + totalRecurrentes) * 100)}%`,
          hint: "de las personas atendidas venían por primera vez",
        },
      ],
      sections: [
        {
          id: "por-mes",
          title: "Pacientes por mes",
          view: "line",
          columns: [
            { key: "mes", label: "Mes" },
            { key: "nuevos", label: "Nuevos", align: "right", format: "number" },
            { key: "recurrentes", label: "Recurrentes", align: "right", format: "number" },
            { key: "total", label: "Total", align: "right", format: "number" },
            { key: "captacion", label: "% nuevos", align: "right", format: "percent" },
          ],
          rows,
          labelKey: "mes",
          valueKey: "nuevos",
          valueKey2: "recurrentes",
        },
      ],
      notes: [
        "Se cuentan PERSONAS distintas por mes, no citas: alguien con tres visitas en el mismo mes suma una.",
        "«Nuevo» significa que su primera cita en la clínica cayó en ese mes. El sistema no guarda la fecha de alta del paciente, así que se deriva de las citas — y esa es, además, la definición que le sirve a la clínica.",
        ...(totalNuevos + totalRecurrentes > 0 && (filters.doctorId || filters.specialtyId)
          ? [
              "Con un filtro de médico o especialidad, «primera cita» se sigue evaluando sobre toda la clínica: alguien que ya era paciente y consulta esta especialidad por primera vez cuenta como recurrente.",
            ]
          : []),
      ],
    };
  },
};
