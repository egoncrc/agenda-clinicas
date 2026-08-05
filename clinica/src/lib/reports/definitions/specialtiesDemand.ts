import { baseAppointmentFilter, countAppointmentsBy, ratio } from "../shared";
import { SIN_DATO } from "../types";
import type { ReportContext, ReportDefinition } from "../types";

/**
 * `appointments` no tiene campo de especialidad, así que se agrupa por `service`
 * en el servidor y se remapea a especialidad en memoria (el catálogo de
 * servicios son decenas de filas, no millones). Se usa la especialidad del
 * SERVICIO y no la del médico: es la que pidió el paciente, y a diferencia de la
 * del médico no depende de la sede — ver ReportContext.
 */

export const specialtiesDemandReport: ReportDefinition = {
  id: "especialidades-demandadas",
  title: "Especialidades más demandadas",
  description: "Distribución de las citas del período entre las especialidades de la clínica.",
  icon: "pie",
  roles: ["admin", "recepcion", "medico"],
  filters: ["rango", "clinicId", "doctorId"],

  async run(filters, ctx: ReportContext) {
    const grupos = await countAppointmentsBy("service", baseAppointmentFilter(filters, ctx.clinicIds));

    const counts = new Map<string, number>();
    for (const g of grupos) {
      const id = g.key ? ctx.specialtyOfService(g.key) : null;
      const label = id ? ctx.specialtyName(id) : SIN_DATO;
      counts.set(label, (counts.get(label) ?? 0) + g.count);
    }

    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const rows = [...counts.entries()]
      .map(([especialidad, cantidad]) => ({
        especialidad,
        cantidad,
        porcentaje: ratio(cantidad, total),
      }))
      .sort((a, b) => a.especialidad.localeCompare(b.especialidad, "es"));

    // La tabla va alfabética; la más demandada se busca aparte, no es "la primera fila".
    const top = rows.reduce<(typeof rows)[number] | null>(
      (max, r) => (!max || r.cantidad > max.cantidad ? r : max),
      null,
    );

    return {
      kpis: [
        { label: "Citas del período", value: String(total) },
        { label: "Especialidades con demanda", value: String(rows.length) },
        {
          label: "Más demandada",
          value: top?.especialidad ?? "—",
          hint: top ? `${Math.round(top.porcentaje * 100)}% de las citas` : undefined,
        },
      ],
      sections: [
        {
          id: "ranking",
          title: "Citas por especialidad",
          view: "donut",
          columns: [
            { key: "especialidad", label: "Especialidad" },
            { key: "cantidad", label: "Citas", align: "right", format: "number" },
            { key: "porcentaje", label: "% del total", align: "right", format: "percent" },
          ],
          rows,
          labelKey: "especialidad",
          valueKey: "cantidad",
        },
      ],
    };
  },
};
