import { fetchAppointments, fetchPatients, ratio } from "../shared";
import { SIN_DATO } from "../types";
import type { Column, ReportContext, ReportDefinition } from "../types";

/**
 * De dónde vienen los pacientes que agendan. Dos pasos obligados: `appointments`
 * no tiene la dirección, así que primero se sacan los pacientes distintos con
 * cita en el rango y después se leen sus fichas.
 *
 * Se cuentan PERSONAS, no citas: la pregunta es de qué zonas viene la clientela
 * (para decidir dónde pautar o si abrir otra sede), y contar citas le daría triple
 * peso a un paciente de tratamiento largo.
 *
 * Provincia/cantón/distrito se guardan como nombre, no como código
 * (scripts/provision-patient-fields.ts), así que agrupar por el texto es correcto.
 */

const COLUMNS = (primera: string, extra: Column[] = []): Column[] => [
  { key: "label", label: primera },
  ...extra,
  { key: "pacientes", label: "Pacientes", align: "right", format: "number" },
  { key: "porcentaje", label: "% del total", align: "right", format: "percent" },
];

function contar(valores: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of valores) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

function filas(counts: Map<string, number>, total: number): Record<string, unknown>[] {
  return [...counts.entries()]
    .map(([label, pacientes]) => ({ label, pacientes, porcentaje: ratio(pacientes, total) }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export const residenceReport: ReportDefinition = {
  id: "residencia-pacientes",
  title: "Residencia de pacientes",
  description:
    "De qué provincia, cantón y distrito vienen los pacientes que agendaron citas en el período.",
  icon: "map",
  roles: ["admin", "recepcion", "medico"],
  filters: ["rango", "clinicId", "doctorId", "specialtyId"],

  async run(filters, ctx: ReportContext) {
    const citas = await fetchAppointments(filters, ctx.clinicIds);
    const filtradas = filters.specialtyId
      ? citas.filter((a) => ctx.specialtyOfService(a.service) === filters.specialtyId)
      : citas;

    const patients = await fetchPatients(filtradas.map((a) => a.patient));
    const total = patients.length;

    const provincias = contar(patients.map((p) => p.provincia?.trim() || SIN_DATO));
    const cantones = contar(
      patients.map((p) => {
        const prov = p.provincia?.trim();
        const cant = p.canton?.trim();
        // El cantón se cualifica con su provincia: hay nombres repetidos entre
        // provincias y sin el prefijo se sumarían dos zonas distintas.
        return prov && cant ? `${prov} · ${cant}` : SIN_DATO;
      }),
    );
    const distritos = contar(
      patients.map((p) => {
        const cant = p.canton?.trim();
        const dist = p.distrito?.trim();
        return cant && dist ? `${cant} · ${dist}` : SIN_DATO;
      }),
    );

    const sinDireccion = provincias.get(SIN_DATO) ?? 0;

    return {
      kpis: [
        { label: "Pacientes atendidos", value: String(total), hint: "personas distintas" },
        {
          label: "Provincias",
          value: String([...provincias.keys()].filter((k) => k !== SIN_DATO).length),
        },
        {
          label: "Sin dirección registrada",
          value: String(sinDireccion),
          hint: total > 0 ? `${Math.round(ratio(sinDireccion, total) * 100)}% de los pacientes` : undefined,
          tone: ratio(sinDireccion, total) >= 0.3 ? "warn" : "default",
        },
      ],
      sections: [
        {
          id: "por-provincia",
          title: "Pacientes por provincia",
          view: "donut",
          columns: COLUMNS("Provincia"),
          rows: filas(provincias, total),
          labelKey: "label",
          valueKey: "pacientes",
        },
        {
          id: "por-canton",
          title: "Pacientes por cantón",
          view: "bar",
          columns: COLUMNS("Provincia · Cantón"),
          rows: filas(cantones, total),
          labelKey: "label",
          valueKey: "pacientes",
        },
        {
          id: "por-distrito",
          title: "Pacientes por distrito",
          view: "table",
          columns: COLUMNS("Cantón · Distrito"),
          rows: filas(distritos, total),
        },
      ],
      notes: [
        "Cuenta personas distintas con al menos una cita en el período, no cantidad de citas.",
        ...(sinDireccion > 0
          ? [
              `${sinDireccion} paciente(s) no tienen dirección cargada y aparecen como «${SIN_DATO}». Se completa desde la pantalla Pacientes.`,
            ]
          : []),
      ],
    };
  },
};
