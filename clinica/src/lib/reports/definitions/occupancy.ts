import { CLINIC_TIMEZONE, REPORT_SLOT_MINUTES } from "@/lib/dateRanges";
import { computeOccupancy } from "../occupancy";
import type { DoctorOccupancy, HourBucket } from "../occupancy";
import { BLOCKING_STATUSES, fetchAppointments, fetchTimeOff, fetchWorkingHours, ratio } from "../shared";
import { SIN_DATO } from "../types";
import type { Column, ReportContext, ReportDefinition, ReportSection } from "../types";

const MIN_POR_HORA = 60;

const OCUPACION_COLUMNS = (primera: string): Column[] => [
  { key: "label", label: primera },
  { key: "horasDisponibles", label: "Horas disponibles", align: "right", format: "hours" },
  { key: "horasOcupadas", label: "Horas ocupadas", align: "right", format: "hours" },
  { key: "ocupacion", label: "Ocupación", align: "right", format: "percent" },
  { key: "citas", label: "Citas", align: "right", format: "number" },
];

interface Acumulado {
  minutosDisponibles: number;
  minutosOcupados: number;
  citas: number;
}

function acumular<T>(items: T[], keyOf: (item: T) => string, valueOf: (item: T) => Acumulado) {
  const map = new Map<string, Acumulado>();
  for (const item of items) {
    const key = keyOf(item);
    const acc = map.get(key) ?? { minutosDisponibles: 0, minutosOcupados: 0, citas: 0 };
    const v = valueOf(item);
    acc.minutosDisponibles += v.minutosDisponibles;
    acc.minutosOcupados += v.minutosOcupados;
    acc.citas += v.citas;
    map.set(key, acc);
  }
  return map;
}

function filas(map: Map<string, Acumulado>): Record<string, unknown>[] {
  return [...map.entries()]
    .map(([label, a]) => ({
      label,
      horasDisponibles: a.minutosDisponibles / MIN_POR_HORA,
      horasOcupadas: a.minutosOcupados / MIN_POR_HORA,
      ocupacion: ratio(a.minutosOcupados, a.minutosDisponibles),
      citas: a.citas,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

/** "10:00, 11:00" — las horas con más citas iniciadas. Vacío si no hubo ninguna. */
function horasDestacadas(buckets: HourBucket[], cuantas: number): string {
  const conCitas = buckets.filter((b) => b.citas > 0);
  if (conCitas.length === 0) return "—";
  return [...conCitas]
    .sort((a, b) => b.citas - a.citas || a.hora - b.hora)
    .slice(0, cuantas)
    .map((b) => `${String(b.hora).padStart(2, "0")}:00`)
    .join(", ");
}

/**
 * Horas de menor demanda: las que TENÍAN agenda abierta y se aprovecharon menos.
 * Mirar solo el conteo de citas señalaría las horas en que la clínica ni siquiera
 * abre, que no es un problema que nadie pueda accionar.
 */
function horasFlojas(buckets: HourBucket[], cuantas: number): string {
  const abiertas = buckets.filter((b) => b.minutosDisponibles > 0);
  if (abiertas.length === 0) return "—";
  return [...abiertas]
    .sort(
      (a, b) =>
        ratio(a.minutosOcupados, a.minutosDisponibles) - ratio(b.minutosOcupados, b.minutosDisponibles) ||
        a.hora - b.hora,
    )
    .slice(0, cuantas)
    .map((b) => `${String(b.hora).padStart(2, "0")}:00`)
    .join(", ");
}

export const occupancyReport: ReportDefinition = {
  id: "ocupacion-agenda",
  title: "Ocupación de agenda",
  description:
    "Qué tan aprovechada está la agenda: horas disponibles frente a horas reservadas, con las horas pico y las de menor demanda.",
  icon: "gauge",
  roles: ["admin", "recepcion", "medico"],
  filters: ["rango", "clinicId", "doctorId", "specialtyId", "groupBy"],

  async run(filters, ctx: ReportContext) {
    const [appointments, workingHours, timeOff] = await Promise.all([
      fetchAppointments(filters, ctx.clinicIds, BLOCKING_STATUSES),
      fetchWorkingHours(filters, ctx.clinicIds),
      fetchTimeOff(filters, ctx.clinicIds),
    ]);

    // El filtro por especialidad se aplica acá y no en la consulta: la
    // especialidad de una cita es la de su servicio (ver ReportContext), y la de
    // las horas de agenda la del médico, así que no hay un campo único por el que
    // Directus pueda filtrar las dos cosas a la vez.
    const especialidad = filters.specialtyId;
    const citasFiltradas = especialidad
      ? appointments.filter((a) => ctx.specialtyOfService(a.service) === especialidad)
      : appointments;
    const horariosFiltrados = especialidad
      ? workingHours.filter((w) => ctx.specialtyOfDoctor(w.doctor) === especialidad)
      : workingHours;

    const resultado = computeOccupancy({
      desde: filters.desde,
      hasta: filters.hasta,
      timezone: CLINIC_TIMEZONE,
      workingHours: horariosFiltrados,
      timeOff,
      appointments: citasFiltradas,
    });

    const { totales, porMedico, porHora } = resultado;
    const espaciosDisponibles = Math.floor(totales.minutosDisponibles / REPORT_SLOT_MINUTES);
    const espaciosOcupados = Math.round(totales.minutosOcupados / REPORT_SLOT_MINUTES);

    const sections: ReportSection[] = [];
    const porEspecialidad = () =>
      acumular(
        porMedico,
        (d: DoctorOccupancy) => {
          const id = ctx.specialtyOfDoctor(d.doctorId);
          return id ? ctx.specialtyName(id) : SIN_DATO;
        },
        (d) => d,
      );

    if (filters.groupBy === "especialidad" || filters.groupBy === "ambos") {
      sections.push({
        id: "por-especialidad",
        title: "Ocupación por especialidad",
        view: "table",
        columns: OCUPACION_COLUMNS("Especialidad"),
        rows: filas(porEspecialidad()),
      });
    }
    if (filters.groupBy === "medico" || filters.groupBy === "ambos") {
      sections.push({
        id: "por-medico",
        title: "Ocupación por médico",
        view: "table",
        columns: OCUPACION_COLUMNS("Médico"),
        rows: filas(acumular(porMedico, (d) => ctx.doctorName(d.doctorId), (d) => d)),
      });
    }

    // Excepción deliberada al orden alfabético del resto de Reportes: es un eje
    // horario, no una lista de categorías, y `porHora` ya viene ascendente por
    // hora del día (computeOccupancy la ordena así); alfabetizar "00:00".."23:00"
    // como texto la dejaría igual solo por el cero a la izquierda, así que no hay
    // nada que cambiar, pero tampoco hay que tocarlo.
    sections.push({
      id: "por-hora",
      title: "Demanda por hora del día",
      view: "bar",
      labelKey: "label",
      valueKey: "citas",
      columns: [
        { key: "label", label: "Hora" },
        { key: "citas", label: "Citas iniciadas", align: "right", format: "number" },
        { key: "horasDisponibles", label: "Horas de agenda", align: "right", format: "hours" },
        { key: "ocupacion", label: "Ocupación", align: "right", format: "percent" },
      ],
      rows: porHora.map((b) => ({
        label: `${String(b.hora).padStart(2, "0")}:00`,
        citas: b.citas,
        horasDisponibles: b.minutosDisponibles / MIN_POR_HORA,
        ocupacion: ratio(b.minutosOcupados, b.minutosDisponibles),
      })),
    });

    const notes: string[] = [];
    if (totales.minutosFueraDeHorario > 0) {
      notes.push(
        `Hay ${(totales.minutosFueraDeHorario / MIN_POR_HORA).toFixed(1)} h de citas fuera del horario declarado (o dentro de una ausencia). No se cuentan como ocupación para que el porcentaje no pase de 100%; revisá el horario de esos médicos.`,
      );
    }
    if (totales.minutosDisponibles === 0) {
      notes.push(
        "No hay horas de agenda cargadas para el rango y los filtros elegidos, así que el porcentaje de ocupación no se puede calcular. Revisá la pantalla Horario.",
      );
    }

    return {
      kpis: [
        {
          label: "Espacios disponibles",
          value: String(espaciosDisponibles),
          hint: `bloques de ${REPORT_SLOT_MINUTES} min`,
        },
        { label: "Citas reservadas", value: String(totales.citas) },
        {
          label: "Espacios libres",
          value: String(Math.max(0, espaciosDisponibles - espaciosOcupados)),
        },
        {
          label: "Ocupación",
          value: `${Math.round(ratio(totales.minutosOcupados, totales.minutosDisponibles) * 100)}%`,
          tone: ratio(totales.minutosOcupados, totales.minutosDisponibles) >= 0.85 ? "success" : "default",
        },
        { label: "Horas pico", value: horasDestacadas(porHora, 2) },
        { label: "Menor demanda", value: horasFlojas(porHora, 2) },
      ],
      sections,
      notes,
    };
  },
};
