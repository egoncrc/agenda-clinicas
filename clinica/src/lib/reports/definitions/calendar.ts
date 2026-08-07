import { ESTADO_LABELS } from "@/lib/appointmentStatus";
import type { AppointmentStatus } from "@/lib/directus";
import { fetchAppointments, fetchPatients, ratio } from "../shared";
import type { Column, ReportContext, ReportDefinition, ReportSection } from "../types";

/** Igual criterio que Cancelaciones/No presentados: una cita "cayó" si no llegó a completarse por esas dos vías. */
const ESTADOS_CAIDOS: AppointmentStatus[] = ["cancelada", "no_show"];

const COLUMNS: Column[] = [
  { key: "inicio", label: "Fecha y hora", format: "datetime" },
  { key: "medico", label: "Médico" },
  { key: "especialidad", label: "Especialidad" },
  { key: "servicio", label: "Servicio" },
  { key: "paciente", label: "Paciente" },
  { key: "estado", label: "Estado" },
];

export const calendarReport: ReportDefinition = {
  id: "calendario-citas",
  title: "Calendario de citas",
  description: "Panorama visual de la agenda por día, semana o mes, filtrable por especialidad y médico.",
  icon: "calendar",
  roles: ["admin", "recepcion", "medico"],
  filters: ["rango", "clinicId", "doctorId", "specialtyId"],

  async run(filters, ctx: ReportContext) {
    // Sin filtro de estado: es un panorama, no un ranking — se quiere ver también
    // lo cancelado y lo no presentado (con su propio color), no solo la agenda viva.
    const appointments = await fetchAppointments(filters, ctx.clinicIds);

    // Especialidad de una cita = la de su servicio (ver ReportContext), mismo
    // patrón que occupancy.ts: no hay un campo único por el que Directus pueda
    // filtrar esto en la consulta.
    const filtradas = filters.specialtyId
      ? appointments.filter((a) => ctx.specialtyOfService(a.service) === filters.specialtyId)
      : appointments;

    const patients = await fetchPatients(filtradas.map((a) => a.patient));
    const patientName = new Map(patients.map((p) => [p.id, p.nombre || p.telefono]));

    // Filas planas: `columns` es lo que exportan Excel/PDF (igual que cualquier
    // otro reporte). `doctorId`, `fin` y `estadoRaw` viajan en la fila pero NO
    // están en `columns`, así que el exportador los ignora — son solo para que
    // CalendarBoard pueda agrupar por médico y posicionar el bloque por horario.
    const rows = filtradas.map((a) => ({
      id: a.id,
      inicio: a.inicio,
      fin: a.fin,
      doctorId: a.doctor,
      medico: ctx.doctorName(a.doctor),
      especialidad: (() => {
        const id = ctx.specialtyOfService(a.service);
        return id ? ctx.specialtyName(id) : "Sin especificar";
      })(),
      servicio: ctx.serviceName(a.service),
      paciente: patientName.get(a.patient) ?? "(paciente)",
      estado: ESTADO_LABELS[a.estado],
      estadoRaw: a.estado,
    }));

    const caidas = filtradas.filter((a) => ESTADOS_CAIDOS.includes(a.estado)).length;
    const activas = filtradas.length - caidas;

    // Un rango "Personalizado" puede ser de cualquier largo: no tiene una forma de
    // grilla natural (¿semanas? ¿meses?), así que ahí se cae a tabla cronológica
    // simple. Día/Semana/Mes de la barra de filtros SÍ son las tres vistas del
    // calendario (ver rangeFromPreset en filters.ts) y usan la grilla visual.
    const section: ReportSection = {
      id: "agenda",
      title: filters.preset === "personalizado" ? "Citas del período" : "Agenda",
      view: filters.preset === "personalizado" ? "table" : "calendar",
      columns: COLUMNS,
      rows,
    };

    return {
      kpis: [
        { label: "Citas del período", value: String(filtradas.length) },
        { label: "Activas", value: String(activas), tone: "success" },
        {
          label: "Canceladas / no presentadas",
          value: String(caidas),
          hint: filtradas.length > 0 ? `${Math.round(ratio(caidas, filtradas.length) * 100)}%` : undefined,
          tone: caidas > 0 ? "warn" : "default",
        },
      ],
      sections: [section],
    };
  },
};
