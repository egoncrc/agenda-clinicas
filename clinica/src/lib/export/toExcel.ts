import { DateTime } from "luxon";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";
import type { Column, ColumnFormat, ReportResult } from "@/lib/reports/types";
import { downloadBlob, type ExportMeta } from "./download";

/**
 * Exporta un `ReportResult` a un .xlsx real. Genérico: no sabe qué reporte está
 * escribiendo, solo recorre `sections`, así que un reporte nuevo se exporta solo.
 *
 * REGLA CENTRAL: los valores van CRUDOS con formato de celda nativo, nunca como
 * texto ya formateado. Un "91%" escrito como cadena convierte la columna en algo
 * que no se puede ordenar, ni promediar, ni graficar — y el motivo por el que
 * alguien exporta a Excel es justamente hacer eso.
 */

/** Formatos numéricos de Excel por tipo de columna. */
const NUM_FMT: Record<ColumnFormat, string | undefined> = {
  text: undefined,
  number: "#,##0.##",
  percent: "0%",
  hours: '#,##0.0" h"',
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm",
};

/**
 * Excel no guarda zona horaria: interpreta la fecha tal cual. ExcelJS serializa
 * un `Date` por sus componentes UTC, así que se construye uno cuyos campos UTC
 * son la hora de pared de la clínica. Sin esto una cita de las 08:00 en Costa
 * Rica aparecería en la hoja como las 14:00.
 */
function toExcelDate(raw: unknown): Date | string {
  const dt = DateTime.fromISO(String(raw), { zone: CLINIC_TIMEZONE });
  if (!dt.isValid) return String(raw);
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second));
}

function cellValue(raw: unknown, format: ColumnFormat): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  if (format === "date" || format === "datetime") return toExcelDate(raw);
  return raw;
}

/**
 * Ancho por columna a partir del contenido. ExcelJS no tiene autoajuste, y sin
 * esto todo sale en la anchura por defecto: los nombres largos quedan cortados y
 * las fechas se ven como "#####".
 */
function columnWidth(col: Column, rows: Record<string, unknown>[]): number {
  const largoDatos = rows.reduce((max, row) => {
    const v = row[col.key];
    return Math.max(max, v === null || v === undefined ? 0 : String(v).length);
  }, 0);
  const base = Math.max(col.label.length, Math.min(largoDatos, 40));
  // Las fechas se muestran formateadas, más anchas que su valor crudo.
  const extra = col.format === "datetime" ? 8 : col.format === "date" ? 4 : 2;
  return base + extra;
}

/**
 * Excel limita el nombre de hoja a 31 caracteres y prohíbe : \ / ? * [ ].
 * Además no admite duplicados, de ahí el sufijo numérico.
 */
function sheetName(title: string, usados: Set<string>): string {
  let base = title.replace(/[:\\/?*[\]]/g, " ").slice(0, 31).trim() || "Hoja";
  let name = base;
  let n = 2;
  while (usados.has(name)) {
    const sufijo = ` ${n++}`;
    name = base.slice(0, 31 - sufijo.length) + sufijo;
  }
  usados.add(name);
  return name;
}

/**
 * Genera el .xlsx y devuelve el Blob. Separado de la descarga a propósito: así se
 * puede probar sin DOM (`toExcel.test.ts`), que es donde de verdad se rompen
 * estas cosas — un formato de celda inválido no falla al escribir, falla al
 * abrir el archivo.
 */
export async function buildExcelBlob(result: ReportResult, meta: ExportMeta): Promise<Blob> {
  // Import dinámico: exceljs pesa bastante y solo hace falta cuando alguien pulsa
  // Exportar, así que no entra en el bundle inicial del panel.
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.clinicName;
  workbook.created = new Date();

  const usados = new Set<string>();

  for (const section of result.sections) {
    const sheet = workbook.addWorksheet(sheetName(section.title, usados));

    const header = sheet.addRow(section.columns.map((c) => c.label));
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    // Fija el encabezado: una tabla de 800 filas es ilegible si al bajar se
    // pierde de vista qué columna es cuál.
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    for (const row of section.rows) {
      const excelRow = sheet.addRow(section.columns.map((c) => cellValue(row[c.key], c.format ?? "text")));
      section.columns.forEach((c, i) => {
        const fmt = NUM_FMT[c.format ?? "text"];
        if (fmt) excelRow.getCell(i + 1).numFmt = fmt;
      });
    }

    section.columns.forEach((c, i) => {
      sheet.getColumn(i + 1).width = columnWidth(c, section.rows);
    });

    // Autofiltro sobre la tabla completa: es lo primero que hace cualquiera al
    // abrir un export, y dejarlo puesto ahorra el paso.
    if (section.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: section.rows.length + 1, column: section.columns.length },
      };
    }

    if (section.note) {
      sheet.addRow([]);
      sheet.addRow([section.note]).font = { italic: true, color: { argb: "FF64748B" } };
    }
  }

  // Hoja de contexto al final: sin ella el archivo, ya fuera del panel, no dice
  // de qué clínica ni de qué período es, y no hay forma de auditarlo después.
  const info = workbook.addWorksheet(sheetName("Filtros", usados));
  info.columns = [{ width: 22 }, { width: 60 }];
  const filas: [string, string][] = [
    ["Reporte", meta.reportTitle],
    ["Clínica", meta.clinicName],
    ["Período", meta.rangeLabel],
    ...meta.filterLines.map((line): [string, string] => {
      const [k, ...rest] = line.split(":");
      return [k?.trim() ?? "", rest.join(":").trim()];
    }),
    ["Generado", meta.generatedAt],
  ];
  for (const [k, v] of filas) {
    const row = info.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
  if (result.notes?.length) {
    info.addRow([]);
    info.addRow(["Notas", ""]).getCell(1).font = { bold: true };
    for (const note of result.notes) info.addRow(["", note]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function exportToExcel(
  result: ReportResult,
  meta: ExportMeta,
  filename: string,
): Promise<void> {
  downloadBlob(await buildExcelBlob(result, meta), filename);
}
