import { baseAppointmentFilter, countAppointmentsBy, ratio } from "../shared";
import { SIN_DATO } from "../types";
import type { ReportContext, ReportDefinition } from "../types";

/**
 * Estados que cuentan como "demanda". Se incluyen las canceladas y las ausencias
 * a propósito: la pregunta es qué piden los pacientes, y un servicio muy pedido
 * pero con muchas caídas sigue siendo muy pedido. Filtrarlas mediría otra cosa
 * (servicios efectivamente prestados), que es lo que responde Productividad.
 */

export const servicesDemandReport: ReportDefinition = {
  id: "servicios-solicitados",
  title: "Servicios más solicitados",
  description: "Ranking de servicios por cantidad de citas agendadas en el período.",
  icon: "list",
  roles: ["admin", "recepcion", "medico"],
  filters: ["rango", "clinicId", "doctorId", "specialtyId"],

  async run(filters, ctx: ReportContext) {
    // Agregado en el servidor: no hace falta traer una fila por cita para contar.
    const grupos = await countAppointmentsBy("service", baseAppointmentFilter(filters, ctx.clinicIds));

    const filtrados = filters.specialtyId
      ? grupos.filter((g) => g.key && ctx.specialtyOfService(g.key) === filters.specialtyId)
      : grupos;

    const total = filtrados.reduce((sum, g) => sum + g.count, 0);
    const rows = filtrados
      .map((g) => ({
        servicio: g.key ? ctx.serviceName(g.key) : SIN_DATO,
        especialidad: (() => {
          const id = g.key ? ctx.specialtyOfService(g.key) : null;
          return id ? ctx.specialtyName(id) : SIN_DATO;
        })(),
        cantidad: g.count,
        porcentaje: ratio(g.count, total),
      }))
      .sort((a, b) => a.servicio.localeCompare(b.servicio, "es"));

    // La tabla va alfabética; el más solicitado se busca aparte, no es "la primera fila".
    const top = rows.reduce<(typeof rows)[number] | null>(
      (max, r) => (!max || r.cantidad > max.cantidad ? r : max),
      null,
    );

    return {
      kpis: [
        { label: "Citas del período", value: String(total) },
        { label: "Servicios distintos", value: String(rows.length) },
        { label: "Más solicitado", value: top?.servicio ?? "—", hint: top ? `${top.cantidad} citas` : undefined },
      ],
      sections: [
        {
          id: "ranking",
          title: "Servicios por demanda",
          view: "bar",
          columns: [
            { key: "servicio", label: "Servicio" },
            { key: "especialidad", label: "Especialidad" },
            { key: "cantidad", label: "Citas", align: "right", format: "number" },
            { key: "porcentaje", label: "% del total", align: "right", format: "percent" },
          ],
          rows,
          labelKey: "servicio",
          valueKey: "cantidad",
        },
      ],
      notes: [
        "Cuenta todas las citas agendadas, incluidas las canceladas y las ausencias: mide lo que los pacientes piden, no lo que se llegó a atender.",
      ],
    };
  },
};
