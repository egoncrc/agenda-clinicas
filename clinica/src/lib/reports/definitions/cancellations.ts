import { DateTime } from "luxon";
import { CANCELLED_BY_LABEL } from "@/lib/directus";
import type { AppointmentRow, CancelledBy } from "@/lib/directus";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";
import {
  countAppointments,
  baseAppointmentFilter,
  fetchAppointments,
  fetchPatients,
  ratio,
  rankingColumns,
  rankingRows,
  tally,
} from "../shared";
import { SIN_DATO } from "../types";
import type { ReportContext, ReportDefinition } from "../types";

/**
 * Anticipación con la que se avisó, en horas. `null` cuando la cita se canceló
 * antes de que existiera el campo `cancelado_en`
 * (scripts/provision-cancellation-fields.ts): no se rellena con un cero ni con la
 * fecha de hoy, porque una anticipación inventada es peor que un hueco visible.
 */
function anticipacionHoras(row: AppointmentRow): number | null {
  if (!row.cancelado_en) return null;
  const ms = new Date(row.inicio).getTime() - new Date(row.cancelado_en).getTime();
  if (!Number.isFinite(ms)) return null;
  // Puede ser negativa: cancelar después de la hora de la cita es un dato real
  // (nadie avisó y se cerró tarde), y esconderlo taparía un problema operativo.
  return ms / 3_600_000;
}

function quienCancelo(row: AppointmentRow): string {
  const v = row.cancelado_por as CancelledBy | null | undefined;
  return v ? (CANCELLED_BY_LABEL[v] ?? v) : SIN_DATO;
}

export const cancellationsReport: ReportDefinition = {
  id: "cancelaciones",
  title: "Cancelaciones",
  description:
    "Citas canceladas con quién las canceló, cuándo y con cuánta anticipación, más el desglose por médico, especialidad, paciente y día.",
  icon: "x",
  roles: ["admin", "recepcion", "medico"],
  filters: ["rango", "clinicId", "doctorId", "specialtyId", "serviceId"],

  async run(filters, ctx: ReportContext) {
    const [canceladas, totalCitas] = await Promise.all([
      fetchAppointments(filters, ctx.clinicIds, ["cancelada"]),
      // Denominador del % de cancelación: TODAS las citas del rango, cualquier
      // estado. Es lo que responde "de cada 100 citas agendadas, cuántas se caen".
      countAppointments(baseAppointmentFilter(filters, ctx.clinicIds)),
    ]);

    const filtradas = filters.specialtyId
      ? canceladas.filter((a) => ctx.specialtyOfService(a.service) === filters.specialtyId)
      : canceladas;

    const patients = await fetchPatients(filtradas.map((a) => a.patient));
    const patientName = new Map(patients.map((p) => [p.id, p.nombre || p.telefono]));
    const nombrePaciente = (id: string) => patientName.get(id) ?? "(paciente)";

    const conAnticipacion = filtradas
      .map(anticipacionHoras)
      .filter((h): h is number => h !== null);
    const promedio =
      conAnticipacion.length > 0
        ? conAnticipacion.reduce((a, b) => a + b, 0) / conAnticipacion.length
        : null;
    const porAusencia = filtradas.filter((a) => a.cancelada_por_ausencia === true).length;
    const sinDato = filtradas.length - conAnticipacion.length;

    const detalle = filtradas.map((a) => ({
      fecha: a.inicio,
      paciente: nombrePaciente(a.patient),
      medico: ctx.doctorName(a.doctor),
      servicio: ctx.serviceName(a.service),
      quien: quienCancelo(a),
      cuando: a.cancelado_en ?? null,
      anticipacion: anticipacionHoras(a),
      motivo: a.motivo_cancelacion || "",
    }));

    const porDia = tally(filtradas, (a) =>
      DateTime.fromISO(a.inicio, { zone: CLINIC_TIMEZONE }).toFormat("yyyy-LL-dd"),
    );

    return {
      kpis: [
        { label: "Canceladas", value: String(filtradas.length), tone: "warn" },
        {
          label: "% de cancelación",
          value: `${Math.round(ratio(filtradas.length, totalCitas) * 100)}%`,
          hint: `sobre ${totalCitas} citas del período`,
          tone: ratio(filtradas.length, totalCitas) >= 0.2 ? "danger" : "default",
        },
        {
          label: "Anticipación media",
          value: promedio === null ? "—" : `${promedio.toFixed(1)} h`,
          hint: sinDato > 0 ? `${sinDato} sin dato` : undefined,
        },
        {
          label: "Por ausencia del médico",
          value: String(porAusencia),
          hint: "las tuvo que cancelar la clínica",
          tone: porAusencia > 0 ? "warn" : "default",
        },
      ],
      sections: [
        {
          id: "detalle",
          title: "Detalle de cancelaciones",
          view: "table",
          columns: [
            { key: "fecha", label: "Fecha de la cita", format: "datetime" },
            { key: "paciente", label: "Paciente" },
            { key: "medico", label: "Médico" },
            { key: "servicio", label: "Servicio" },
            { key: "quien", label: "Canceló" },
            { key: "cuando", label: "Cancelada el", format: "datetime" },
            { key: "anticipacion", label: "Anticipación (h)", align: "right", format: "number" },
            { key: "motivo", label: "Motivo" },
          ],
          rows: detalle,
          note:
            sinDato > 0
              ? `${sinDato} cancelación(es) sin fecha ni autor: son anteriores a que se empezara a registrar ese dato.`
              : undefined,
        },
        {
          id: "por-medico",
          title: "Cancelaciones por médico",
          view: "bar",
          columns: rankingColumns("Médico"),
          rows: rankingRows(tally(filtradas, (a) => ctx.doctorName(a.doctor))),
          labelKey: "label",
          valueKey: "cantidad",
        },
        {
          id: "por-especialidad",
          title: "Cancelaciones por especialidad",
          view: "donut",
          columns: rankingColumns("Especialidad"),
          rows: rankingRows(
            tally(filtradas, (a) => {
              const id = ctx.specialtyOfService(a.service);
              return id ? ctx.specialtyName(id) : SIN_DATO;
            }),
          ),
          labelKey: "label",
          valueKey: "cantidad",
        },
        {
          id: "por-paciente",
          title: "Cancelaciones por paciente",
          view: "table",
          columns: rankingColumns("Paciente"),
          rows: rankingRows(tally(filtradas, (a) => nombrePaciente(a.patient))),
        },
        {
          id: "por-dia",
          title: "Cancelaciones por día",
          view: "line",
          columns: [
            { key: "label", label: "Día", format: "date" },
            { key: "cantidad", label: "Cancelaciones", align: "right", format: "number" },
          ],
          // Cronológico, no por cantidad: es una serie temporal.
          rows: [...porDia.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([label, cantidad]) => ({ label, cantidad })),
          labelKey: "label",
          valueKey: "cantidad",
        },
      ],
    };
  },
};
