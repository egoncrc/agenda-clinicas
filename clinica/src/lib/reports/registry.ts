import type { ReportDefinition, ReportRole } from "./types";
import { occupancyReport } from "./definitions/occupancy";
import { cancellationsReport } from "./definitions/cancellations";
import { noShowsReport } from "./definitions/noShows";
import { productivityReport } from "./definitions/productivity";
import { servicesDemandReport } from "./definitions/servicesDemand";
import { specialtiesDemandReport } from "./definitions/specialtiesDemand";
import { patientMixReport } from "./definitions/patientMix";
import { residenceReport } from "./definitions/residence";

/**
 * Catálogo de reportes. ES EL ÚNICO ARCHIVO QUE HAY QUE TOCAR PARA AGREGAR UNO:
 * la vista, la barra de filtros y los exportadores trabajan contra
 * `ReportDefinition` y no saben qué reportes existen.
 *
 * El orden es el que ve el usuario en el menú.
 */
export const REPORTS: ReportDefinition[] = [
  occupancyReport,
  cancellationsReport,
  noShowsReport,
  productivityReport,
  servicesDemandReport,
  specialtiesDemandReport,
  patientMixReport,
  residenceReport,
];

export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

/**
 * Filtro por rol. Es UX, no seguridad: quien manda es la policy de Directus, que
 * ya recorta las FILAS (un médico solo lee sus propias citas). Esto solo evita
 * ofrecer un reporte que para ese rol no diría nada.
 */
export function reportsForRole(role: ReportRole): ReportDefinition[] {
  return REPORTS.filter((r) => r.roles.includes(role));
}
