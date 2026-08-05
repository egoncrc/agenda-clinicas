import { DateTime } from "luxon";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";
import type { Column, ColumnFormat } from "./types";

/**
 * Formateo de celdas, compartido por la tabla en pantalla y por el PDF.
 *
 * El Excel NO pasa por acá a propósito: ahí el valor va crudo con un formato de
 * celda nativo, para que la hoja se pueda ordenar, filtrar y graficar. Escribir
 * "91%" como texto convierte la columna en inservible.
 */

const NUMBER = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat("es-CR", { style: "percent", maximumFractionDigits: 0 });

export function formatCell(value: unknown, format: ColumnFormat = "text"): string {
  if (value === null || value === undefined || value === "") return "—";

  switch (format) {
    case "number":
      return typeof value === "number" ? NUMBER.format(value) : String(value);
    case "percent":
      return typeof value === "number" ? PERCENT.format(value) : String(value);
    case "hours":
      return typeof value === "number" ? `${NUMBER.format(value)} h` : String(value);
    case "date": {
      const dt = parseDate(String(value));
      return dt ? dt.setLocale("es").toFormat("dd LLL yyyy") : String(value);
    }
    case "datetime": {
      const dt = parseDate(String(value));
      return dt ? dt.setLocale("es").toFormat("dd LLL yyyy, HH:mm") : String(value);
    }
    default:
      return String(value);
  }
}

/** Acepta tanto un ISO completo como el "yyyy-LL-dd" que usan las series por día. */
function parseDate(raw: string): DateTime | null {
  const iso = DateTime.fromISO(raw, { zone: CLINIC_TIMEZONE });
  return iso.isValid ? iso : null;
}

export function formatRow(row: Record<string, unknown>, columns: Column[]): string[] {
  return columns.map((c) => formatCell(row[c.key], c.format));
}

/** Numérico para alinear a la derecha por defecto: lo que se compara de un vistazo son cifras. */
export function alignOf(column: Column): "left" | "right" {
  if (column.align) return column.align;
  return column.format === "number" || column.format === "percent" || column.format === "hours"
    ? "right"
    : "left";
}
