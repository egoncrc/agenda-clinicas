import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildExcelBlob } from "./toExcel";
import { buildPdfBlob } from "./toPdf";
import type { ExportMeta } from "./download";
import type { ReportResult } from "@/lib/reports/types";

/**
 * Pruebas de humo de los dos exportadores. No comprueban estética: comprueban
 * que el archivo SE GENERA y que el .xlsx sale con valores crudos y formato de
 * celda, que es la parte que se rompe en silencio (un "91%" escrito como texto
 * se ve igual de bien en pantalla y deja la hoja inservible).
 */

const META: ExportMeta = {
  reportId: "prueba",
  reportTitle: "Reporte de prueba",
  clinicName: "Clínica Demo",
  rangeLabel: "01 abr 2026 — 30 abr 2026",
  filterLines: ["Sede: Todas", "Médico: Dra. Mora"],
  generatedAt: "04 ago 2026, 10:00",
};

const RESULT: ReportResult = {
  kpis: [
    { label: "Citas", value: "120" },
    { label: "Ocupación", value: "91%", hint: "sobre 160 h" },
  ],
  sections: [
    {
      id: "por-especialidad",
      title: "Ocupación por especialidad",
      view: "table",
      columns: [
        { key: "label", label: "Especialidad" },
        { key: "horasDisponibles", label: "Horas disponibles", format: "hours" },
        { key: "ocupacion", label: "Ocupación", format: "percent" },
        { key: "fecha", label: "Última cita", format: "datetime" },
      ],
      rows: [
        {
          label: "Medicina General",
          horasDisponibles: 160,
          ocupacion: 0.91,
          fecha: "2026-04-15T08:30:00-06:00",
        },
        { label: "Pediatría", horasDisponibles: 120, ocupacion: 0.57, fecha: null },
      ],
      note: "Nota de la sección.",
    },
    {
      id: "vacia",
      title: "Sección sin filas",
      view: "bar",
      columns: [
        { key: "label", label: "Etiqueta" },
        { key: "cantidad", label: "Cantidad", format: "number" },
      ],
      rows: [],
    },
  ],
  notes: ["Una nota general del reporte."],
};

async function readWorkbook(blob: Blob): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  return workbook;
}

describe("buildExcelBlob", () => {
  it("genera un .xlsx que se puede volver a abrir", async () => {
    const workbook = await readWorkbook(await buildExcelBlob(RESULT, META));
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      "Ocupación por especialidad",
      "Sección sin filas",
      "Filtros",
    ]);
  });

  it("escribe los valores CRUDOS con formato de celda, no texto ya formateado", async () => {
    const workbook = await readWorkbook(await buildExcelBlob(RESULT, META));
    const sheet = workbook.getWorksheet("Ocupación por especialidad")!;
    const fila = sheet.getRow(2);

    // 0.91 con formato de porcentaje: Excel lo muestra como 91% y lo puede promediar.
    expect(fila.getCell(3).value).toBe(0.91);
    expect(fila.getCell(3).numFmt).toBe("0%");
    expect(fila.getCell(2).value).toBe(160);
    expect(fila.getCell(2).numFmt).toBe('#,##0.0" h"');
  });

  it("escribe las fechas en la hora de pared de la clínica, no en UTC", async () => {
    const workbook = await readWorkbook(await buildExcelBlob(RESULT, META));
    const celda = workbook.getWorksheet("Ocupación por especialidad")!.getRow(2).getCell(4);
    const fecha = celda.value as Date;
    // 08:30 en Costa Rica. Sin la conversión aparecería como 14:30.
    expect(fecha.getUTCHours()).toBe(8);
    expect(fecha.getUTCMinutes()).toBe(30);
    expect(fecha.getUTCDate()).toBe(15);
  });

  it("deja la celda vacía (no la cadena 'null') cuando no hay dato", async () => {
    const workbook = await readWorkbook(await buildExcelBlob(RESULT, META));
    expect(workbook.getWorksheet("Ocupación por especialidad")!.getRow(3).getCell(4).value).toBeNull();
  });

  it("incluye la hoja de filtros para que el archivo sea auditable fuera del panel", async () => {
    const workbook = await readWorkbook(await buildExcelBlob(RESULT, META));
    const filtros = workbook.getWorksheet("Filtros")!;
    const texto = filtros.getSheetValues().flat().filter(Boolean).map(String).join(" | ");
    expect(texto).toContain("Clínica Demo");
    expect(texto).toContain("01 abr 2026 — 30 abr 2026");
    expect(texto).toContain("Dra. Mora");
    expect(texto).toContain("Una nota general del reporte.");
  });

  it("no repite nombres de hoja ni pasa de 31 caracteres", async () => {
    const largo = "Un título de sección larguísimo que Excel no admite";
    const workbook = await readWorkbook(
      await buildExcelBlob(
        {
          kpis: [],
          sections: [
            { ...RESULT.sections[0]!, id: "a", title: largo },
            { ...RESULT.sections[0]!, id: "b", title: largo },
          ],
        },
        META,
      ),
    );
    const nombres = workbook.worksheets.map((w) => w.name);
    expect(new Set(nombres).size).toBe(nombres.length);
    for (const n of nombres) expect(n.length).toBeLessThanOrEqual(31);
  });
});

describe("buildPdfBlob", () => {
  it("genera un PDF no vacío", async () => {
    const blob = await buildPdfBlob(RESULT, META);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Firma de archivo PDF: "%PDF".
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("no revienta con un reporte sin KPIs, sin notas y con secciones vacías", async () => {
    const blob = await buildPdfBlob(
      { kpis: [], sections: [{ ...RESULT.sections[1]! }] },
      { ...META, filterLines: [] },
    );
    expect(blob.size).toBeGreaterThan(0);
  });
});
