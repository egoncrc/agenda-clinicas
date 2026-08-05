import { DateTime } from "luxon";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";
import type { ReportFilters } from "@/lib/reports/types";

/** Metadatos del encabezado, iguales para PDF y Excel. */
export interface ExportMeta {
  reportId: string;
  reportTitle: string;
  clinicName: string;
  rangeLabel: string;
  /** "Médico: Dra. Mora", "Especialidad: Todas"… tal como se van a imprimir. */
  filterLines: string[];
  generatedAt: string;
}

export function buildExportMeta(
  reportId: string,
  reportTitle: string,
  clinicName: string,
  rangeLabel: string,
  filterLines: string[],
): ExportMeta {
  return {
    reportId,
    reportTitle,
    clinicName,
    rangeLabel,
    filterLines,
    generatedAt: DateTime.now().setZone(CLINIC_TIMEZONE).setLocale("es").toFormat("dd LLL yyyy, HH:mm"),
  };
}

/**
 * Nombre del archivo: identifica el reporte y el período sin abrirlo. Quien baja
 * el mismo reporte de tres meses distintos termina con tres archivos que se
 * distinguen en el explorador, no con "reporte (2).pdf".
 */
export function exportFilename(reportId: string, filters: ReportFilters, ext: "pdf" | "xlsx"): string {
  const desde = DateTime.fromISO(filters.desde).setZone(CLINIC_TIMEZONE).toFormat("yyyy-LL-dd");
  const hasta = DateTime.fromISO(filters.hasta).setZone(CLINIC_TIMEZONE).toFormat("yyyy-LL-dd");
  const periodo = desde === hasta ? desde : `${desde}_${hasta}`;
  return `reporte-${reportId}-${periodo}.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Sin esto el blob queda retenido hasta que se recargue la pestaña; un reporte
  // grande bajado varias veces se acumula en memoria.
  URL.revokeObjectURL(url);
}
