import { formatCell } from "@/lib/reports/format";
import { alignOf } from "@/lib/reports/format";
import type { ReportResult } from "@/lib/reports/types";
import { downloadBlob, type ExportMeta } from "./download";

/**
 * Exporta un `ReportResult` a PDF. Genérico igual que el de Excel: recorre
 * `sections` sin saber qué reporte es.
 *
 * A DIFERENCIA DEL EXCEL, aquí los valores SÍ van formateados (`formatCell`): un
 * PDF se lee, no se recalcula, y debe mostrar "91%" igual que la pantalla.
 *
 * V1 SIN GRÁFICOS: se imprimen los KPIs y las tablas. Incrustar los SVG exige
 * rasterizarlos (serializar → <img> → canvas → dataURL) y controlar el escalado
 * en cada corte de página; se deja para cuando alguien lo pida, con el punto de
 * extensión anotado al final del archivo.
 */

const MARGIN = 12;
const BRAND: [number, number, number] = [30, 58, 95];
const SLATE: [number, number, number] = [100, 116, 139];

/**
 * Genera el PDF y devuelve el Blob. Separado de la descarga por el mismo motivo
 * que en el Excel: permite probar la generación sin DOM (`toPdf.test.ts`).
 */
export async function buildPdfBlob(result: ReportResult, meta: ExportMeta): Promise<Blob> {
  // Import dinámico, igual que exceljs: jspdf no debe pesar en la carga del panel.
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableModule.default;

  // Apaisado: las tablas de estos reportes llegan a ocho columnas y en vertical
  // se comprimen hasta ser ilegibles.
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  let y = MARGIN;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...BRAND);
  doc.text(meta.reportTitle, MARGIN, y + 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  doc.text(meta.clinicName, pageWidth - MARGIN, y + 4, { align: "right" });
  y += 10;

  doc.setFontSize(9);
  doc.text(meta.rangeLabel, MARGIN, y);
  y += 5;
  if (meta.filterLines.length > 0) {
    // Los filtros van impresos: un reporte sin ellos es un montón de cifras que
    // nadie puede reproducir ni discutir tres semanas después.
    const texto = doc.splitTextToSize(meta.filterLines.join("   ·   "), pageWidth - MARGIN * 2) as string[];
    doc.text(texto, MARGIN, y);
    y += texto.length * 4;
  }
  y += 3;

  if (result.kpis.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [result.kpis.map((k) => k.label)],
      body: [
        result.kpis.map((k) => (k.hint ? `${k.value}\n${k.hint}` : k.value)),
      ],
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2, halign: "center" },
      headStyles: { fillColor: BRAND, textColor: 255, fontSize: 8 },
      bodyStyles: { fontStyle: "bold", fontSize: 11 },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  const pageHeight = doc.internal.pageSize.getHeight();

  for (const section of result.sections) {
    // Un título solo al pie de la página, con su tabla en la siguiente, se lee
    // como si sobrara. Si no entran título + un par de filas, se salta de página.
    if (y > pageHeight - 40) {
      doc.addPage();
      y = MARGIN;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...BRAND);
    doc.text(section.title, MARGIN, y + 3);
    y += 7;

    autoTable(doc, {
      startY: y,
      head: [section.columns.map((c) => c.label)],
      body: section.rows.map((row) => section.columns.map((c) => formatCell(row[c.key], c.format))),
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 1.6, overflow: "linebreak" },
      headStyles: { fillColor: BRAND, textColor: 255, fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries(section.columns.map((c, i) => [i, { halign: alignOf(c) }])),
      margin: { left: MARGIN, right: MARGIN },
      // La cabecera se repite en cada página: sin esto, la continuación de una
      // tabla larga es una parrilla de números sin nombres de columna.
      showHead: "everyPage",
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

    if (section.note) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(...SLATE);
      const nota = doc.splitTextToSize(section.note, pageWidth - MARGIN * 2) as string[];
      doc.text(nota, MARGIN, y);
      y += nota.length * 3.2;
    }
    y += 5;
  }

  if (result.notes?.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    for (const note of result.notes) {
      const lineas = doc.splitTextToSize(`• ${note}`, pageWidth - MARGIN * 2) as string[];
      doc.text(lineas, MARGIN, y);
      y += lineas.length * 3.4;
    }
  }

  // Pie en todas las páginas. Se hace al final porque hasta acá no se sabe
  // cuántas páginas salieron y "Página 2 de 5" necesita el total.
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(`Generado el ${meta.generatedAt}`, MARGIN, pageHeight - 6);
    doc.text(`Página ${i} de ${total}`, pageWidth - MARGIN, pageHeight - 6, { align: "right" });
  }

  return doc.output("blob");
}

export async function exportToPdf(
  result: ReportResult,
  meta: ExportMeta,
  filename: string,
): Promise<void> {
  downloadBlob(await buildPdfBlob(result, meta), filename);
}

/**
 * PUNTO DE EXTENSIÓN para incrustar los gráficos:
 *
 *   1. `new XMLSerializer().serializeToString(svgEl)`
 *   2. cargarlo en un `<img>` con `data:image/svg+xml;base64,...`
 *   3. dibujarlo en un `<canvas>` del tamaño deseado
 *   4. `canvas.toDataURL("image/png")` y `doc.addImage(...)`
 *
 * El detalle a resolver es que los SVG del panel usan variables CSS
 * (`var(--color-brand-600)`), que no se resuelven dentro de un `<img>`: hay que
 * sustituirlas por su valor calculado antes de serializar.
 */
