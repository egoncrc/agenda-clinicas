import { CLINIC_TIMEZONE } from "@/lib/dateRanges";
import { computeOccupancy } from "../occupancy";
import {
  BLOCKING_STATUSES,
  durationMinutes,
  fetchAppointments,
  fetchTimeOff,
  fetchWorkingHours,
  ratio,
} from "../shared";
import type { ReportContext, ReportDefinition } from "../types";

const MIN_POR_HORA = 60;

/**
 * INGRESOS GENERADOS: pendiente y deliberadamente fuera. El esquema no tiene
 * ningún campo de precio (ni en `services` ni en `appointments`), así que la
 * columna solo podría salir inventada. Cuando exista facturación hará falta un
 * `services.precio` MÁS un monto congelado en la cita: si se calculara con el
 * precio vigente del catálogo, subir una tarifa reescribiría hacia atrás los
 * ingresos de todos los meses ya cerrados.
 */

export const productivityReport: ReportDefinition = {
  id: "productividad-medica",
  title: "Productividad médica",
  description:
    "Cuánto trabaja cada médico: citas atendidas, horas efectivas, duración promedio de la consulta, cancelaciones, ausencias y ocupación.",
  icon: "chart",
  roles: ["admin", "recepcion", "medico"],
  filters: ["rango", "clinicId", "doctorId", "specialtyId"],

  async run(filters, ctx: ReportContext) {
    const [todas, workingHours, timeOff] = await Promise.all([
      // Sin filtro de estado: una sola lectura sirve para atendidas, canceladas y
      // ausencias, y se reparten en memoria. Tres consultas darían lo mismo con
      // el triple de viajes.
      fetchAppointments(filters, ctx.clinicIds),
      fetchWorkingHours(filters, ctx.clinicIds),
      fetchTimeOff(filters, ctx.clinicIds),
    ]);

    const especialidad = filters.specialtyId;
    const citas = especialidad
      ? todas.filter((a) => ctx.specialtyOfService(a.service) === especialidad)
      : todas;
    const horarios = especialidad
      ? workingHours.filter((w) => ctx.specialtyOfDoctor(w.doctor) === especialidad)
      : workingHours;

    // La ocupación se toma prestada del reporte 1 en vez de recalcularse: es la
    // misma pregunta y duplicar esa matemática garantizaría que los dos reportes
    // terminen dando números distintos.
    const ocupacion = computeOccupancy({
      desde: filters.desde,
      hasta: filters.hasta,
      timezone: CLINIC_TIMEZONE,
      workingHours: horarios,
      timeOff,
      appointments: citas.filter((a) => BLOCKING_STATUSES.includes(a.estado)),
    });
    const ocupacionPorMedico = new Map(ocupacion.porMedico.map((d) => [d.doctorId, d]));

    interface Fila {
      atendidas: number;
      minutosAtendidos: number;
      canceladas: number;
      noShows: number;
    }
    const porMedico = new Map<string, Fila>();
    const fila = (id: string): Fila => {
      let f = porMedico.get(id);
      if (!f) {
        f = { atendidas: 0, minutosAtendidos: 0, canceladas: 0, noShows: 0 };
        porMedico.set(id, f);
      }
      return f;
    };

    for (const a of citas) {
      const f = fila(a.doctor);
      if (a.estado === "completada") {
        f.atendidas += 1;
        f.minutosAtendidos += durationMinutes(a);
      } else if (a.estado === "cancelada") {
        f.canceladas += 1;
      } else if (a.estado === "no_show") {
        f.noShows += 1;
      }
    }
    // Un médico con agenda abierta y cero citas también es información: aparece
    // con 0% de ocupación en vez de desaparecer del reporte.
    for (const d of ocupacion.porMedico) fila(d.doctorId);

    const rows = [...porMedico.entries()]
      .map(([doctorId, f]) => {
        const occ = ocupacionPorMedico.get(doctorId);
        return {
          medico: ctx.doctorName(doctorId),
          citas: f.atendidas,
          horas: f.minutosAtendidos / MIN_POR_HORA,
          promedio: f.atendidas > 0 ? f.minutosAtendidos / f.atendidas : 0,
          canceladas: f.canceladas,
          noShows: f.noShows,
          ocupacion: occ ? ratio(occ.minutosOcupados, occ.minutosDisponibles) : 0,
        };
      })
      .sort((a, b) => a.medico.localeCompare(b.medico, "es"));

    const totales = rows.reduce(
      (acc, r) => ({
        citas: acc.citas + r.citas,
        horas: acc.horas + r.horas,
        canceladas: acc.canceladas + r.canceladas,
        noShows: acc.noShows + r.noShows,
      }),
      { citas: 0, horas: 0, canceladas: 0, noShows: 0 },
    );

    return {
      kpis: [
        { label: "Citas atendidas", value: String(totales.citas), tone: "success" },
        { label: "Horas efectivas", value: `${totales.horas.toFixed(1)} h` },
        {
          label: "Promedio por consulta",
          value:
            totales.citas > 0 ? `${Math.round((totales.horas * MIN_POR_HORA) / totales.citas)} min` : "—",
        },
        { label: "Canceladas", value: String(totales.canceladas), tone: "warn" },
        { label: "No presentados", value: String(totales.noShows), tone: "warn" },
      ],
      sections: [
        {
          id: "por-medico",
          title: "Productividad por médico",
          view: "table",
          columns: [
            { key: "medico", label: "Médico" },
            { key: "citas", label: "Citas atendidas", align: "right", format: "number" },
            { key: "horas", label: "Horas efectivas", align: "right", format: "hours" },
            { key: "promedio", label: "Promedio (min)", align: "right", format: "number" },
            { key: "canceladas", label: "Canceladas", align: "right", format: "number" },
            { key: "noShows", label: "No presentados", align: "right", format: "number" },
            { key: "ocupacion", label: "Ocupación", align: "right", format: "percent" },
          ],
          rows,
        },
        {
          id: "citas-por-medico",
          title: "Citas atendidas por médico",
          view: "bar",
          columns: [
            { key: "medico", label: "Médico" },
            { key: "citas", label: "Citas atendidas", align: "right", format: "number" },
          ],
          rows: rows.map((r) => ({ medico: r.medico, citas: r.citas })),
          labelKey: "medico",
          valueKey: "citas",
        },
      ],
      notes: [
        "«Horas efectivas» suma la duración de las citas completadas; «Ocupación» las compara contra el horario de agenda del período.",
        "Los ingresos generados no se muestran: el sistema todavía no registra el precio de los servicios.",
      ],
    };
  },
};
