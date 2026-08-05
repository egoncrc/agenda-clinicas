import {
  baseAppointmentFilter,
  countAppointments,
  countAppointmentsBy,
  fetchAppointments,
  fetchPatients,
  ratio,
  rankingColumns,
  rankingRows,
  tally,
} from "../shared";
import { SIN_DATO } from "../types";
import type { ReportContext, ReportDefinition } from "../types";

/** A partir de cuántas faltas un paciente se considera reincidente. */
const REINCIDENTE_DESDE = 2;

export const noShowsReport: ReportDefinition = {
  id: "no-presentados",
  title: "No presentados",
  description:
    "Pacientes que no llegaron a su cita, con cuántas veces han faltado en total y la tasa de no-show por médico, especialidad y paciente.",
  icon: "alert",
  roles: ["admin", "recepcion", "medico"],
  filters: ["rango", "clinicId", "doctorId", "specialtyId", "serviceId"],

  async run(filters, ctx: ReportContext) {
    const filtroBase = baseAppointmentFilter(filters, ctx.clinicIds);

    const [noShows, atendidas, historico] = await Promise.all([
      fetchAppointments(filters, ctx.clinicIds, ["no_show"]),
      // Denominador de la tasa: solo las citas que llegaron a su desenlace. Meter
      // las canceladas la diluiría — una cancelación avisada no es una falta, y
      // mezclarlas haría bajar la tasa justo cuando más gente avisa.
      countAppointments({ ...filtroBase, estado: { _eq: "completada" } }),
      // Reincidencia sobre TODO el historial del paciente, no solo el rango: la
      // pregunta operativa es "¿a este paciente le pido confirmación?", y eso no
      // depende de qué mes se esté mirando. Agregado en el servidor.
      countAppointmentsBy("patient", {
        clinic: { _in: ctx.clinicIds },
        estado: { _eq: "no_show" },
      }),
    ]);

    const filtradas = filters.specialtyId
      ? noShows.filter((a) => ctx.specialtyOfService(a.service) === filters.specialtyId)
      : noShows;

    const faltasTotales = new Map(historico.map((g) => [g.key ?? "", g.count]));
    const patients = await fetchPatients(filtradas.map((a) => a.patient));
    const patientName = new Map(patients.map((p) => [p.id, p.nombre || p.telefono]));
    const nombrePaciente = (id: string) => patientName.get(id) ?? "(paciente)";

    const reincidentes = new Set(
      filtradas.map((a) => a.patient).filter((id) => (faltasTotales.get(id) ?? 0) >= REINCIDENTE_DESDE),
    );

    const tasa = ratio(filtradas.length, filtradas.length + atendidas);

    return {
      kpis: [
        { label: "No presentados", value: String(filtradas.length), tone: "warn" },
        {
          label: "Tasa de no-show",
          value: `${Math.round(tasa * 100)}%`,
          hint: `sobre ${filtradas.length + atendidas} citas con desenlace`,
          tone: tasa >= 0.15 ? "danger" : "default",
        },
        {
          label: "Pacientes reincidentes",
          value: String(reincidentes.size),
          hint: `${REINCIDENTE_DESDE}+ faltas históricas`,
          tone: reincidentes.size > 0 ? "warn" : "default",
        },
      ],
      sections: [
        {
          id: "detalle",
          title: "Detalle de ausencias",
          view: "table",
          columns: [
            { key: "fecha", label: "Fecha", format: "datetime" },
            { key: "paciente", label: "Paciente" },
            { key: "medico", label: "Médico" },
            { key: "servicio", label: "Servicio" },
            { key: "faltas", label: "Faltas históricas", align: "right", format: "number" },
          ],
          rows: filtradas.map((a) => ({
            fecha: a.inicio,
            paciente: nombrePaciente(a.patient),
            medico: ctx.doctorName(a.doctor),
            servicio: ctx.serviceName(a.service),
            faltas: faltasTotales.get(a.patient) ?? 1,
          })),
          note: "«Faltas históricas» cuenta todas las ausencias del paciente en la clínica, no solo las del período consultado.",
        },
        {
          id: "por-medico",
          title: "No-show por médico",
          view: "bar",
          columns: rankingColumns("Médico"),
          rows: rankingRows(tally(filtradas, (a) => ctx.doctorName(a.doctor))),
          labelKey: "label",
          valueKey: "cantidad",
        },
        {
          id: "por-especialidad",
          title: "No-show por especialidad",
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
          title: "No-show por paciente",
          view: "table",
          columns: rankingColumns("Paciente"),
          rows: rankingRows(tally(filtradas, (a) => nombrePaciente(a.patient))),
        },
      ],
    };
  },
};
