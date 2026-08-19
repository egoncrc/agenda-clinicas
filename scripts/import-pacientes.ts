/**
 * Importa pacientes desde un Excel (Nombre completo, Cedula, Correo, Telefono)
 * a una clínica fija.
 *
 * EDITA la sección CONFIG de abajo con la ruta del archivo y el id de la
 * clínica destino antes de ejecutar.
 *
 * Uso:
 *   DIRECTUS_ADMIN_TOKEN=<token_admin> npx tsx scripts/import-pacientes.ts --dry-run
 *   DIRECTUS_ADMIN_TOKEN=<token_admin> npx tsx scripts/import-pacientes.ts
 *
 * Idempotencia:
 *   - Se emparejan por `identificacion` (cédula/DIMEX) dentro de la clínica
 *     destino: si ya existe, la fila se salta.
 *   - Filas con el mismo teléfono normalizado: la primera del archivo se crea
 *     como titular (`titular: true`), las siguientes como dependientes bajo
 *     ese mismo número (`titular: false`), igual que `createDependentPatient`
 *     en src/repositories/patients.ts.
 *   - Filas sin un teléfono local (CR, 8 dígitos) o internacional reconstruible
 *     se omiten (no se inventa un valor) y quedan listadas al final del
 *     resumen para revisión manual.
 */
import "dotenv/config";
import ExcelJS from "exceljs";
import { createDirectus, rest, staticToken, createItems, readItems } from "@directus/sdk";
import type { Schema, PatientRow } from "../src/directus.js";

// ============================================================================
// CONFIG — EDITA esto con los datos reales de la importación
// ============================================================================

const EXCEL_PATH = "/home/esteban/Descargas/Pacientes_Dra_Yendry_Unificado.xlsx";
const CLINIC_ID = "ab84d719-3db3-43b0-bc01-b7c9cf5b1d51"; // Servicios Médicos Sta Lucía

const BATCH_SIZE = 50;

// ============================================================================
// Implementación (no hace falta editar debajo de esta línea)
// ============================================================================

const DRY_RUN = process.argv.includes("--dry-run");

const url = process.env.DIRECTUS_URL;
const adminToken = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !adminToken) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN) en el entorno.");
  process.exit(1);
}

const client = createDirectus<Schema>(url).with(staticToken(adminToken)).with(rest());

interface RawRow {
  fila: number;
  nombre: string;
  cedula: string;
  correo: string | null;
  telefonoRaw: string;
}

interface OmittedRow {
  fila: number;
  nombre: string;
  cedula: string;
  motivo: string;
}

interface ImportRow {
  fila: number;
  nombre: string;
  identificacion: string;
  correo: string | null;
  telefono: string;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Normaliza al formato local que usa `patients.telefono` (8 dígitos, sin
 * +506): un local CR ya de 8 dígitos se conserva tal cual; uno internacional
 * (con + y >=10 dígitos) se recorta al prefijo 506 si aplica, o se descarta
 * si no. Cualquier otro caso (longitud rara, vacío, igual a la cédula) no se
 * puede reconstruir con certeza -> null.
 */
function normalizePhone(raw: string, cedula: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 8) return digits;
  if (trimmed.startsWith("+") && digits.startsWith("506") && digits.length === 11) return digits.slice(3);
  if (digits === cedula.replace(/\D/g, "")) return null; // dato de captura: copiaron la cédula
  return null;
}

async function readExcel(): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`El archivo ${EXCEL_PATH} no tiene ninguna hoja.`);

  const rows: RawRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const nombre = cellToString(row.getCell(1).value);
    const cedula = cellToString(row.getCell(2).value);
    const correo = cellToString(row.getCell(3).value) || null;
    const telefonoRaw = cellToString(row.getCell(4).value);
    if (!nombre && !cedula) continue; // fila vacía al final de la hoja
    rows.push({ fila: r, nombre, cedula, correo, telefonoRaw });
  }
  return rows;
}

function buildImportRows(raw: RawRow[]): { toImport: ImportRow[]; omitted: OmittedRow[] } {
  const toImport: ImportRow[] = [];
  const omitted: OmittedRow[] = [];

  for (const row of raw) {
    const telefono = normalizePhone(row.telefonoRaw, row.cedula);
    if (!telefono) {
      const motivo = !row.telefonoRaw
        ? "teléfono vacío"
        : row.telefonoRaw.replace(/\D/g, "") === row.cedula.replace(/\D/g, "")
          ? `teléfono igual a la cédula ("${row.telefonoRaw}")`
          : `teléfono con formato irreconocible ("${row.telefonoRaw}")`;
      omitted.push({ fila: row.fila, nombre: row.nombre, cedula: row.cedula, motivo });
      continue;
    }
    toImport.push({
      fila: row.fila,
      nombre: row.nombre,
      identificacion: row.cedula,
      correo: row.correo,
      telefono,
    });
  }
  return { toImport, omitted };
}

async function fetchExistingIdentificaciones(): Promise<Set<string>> {
  const rows = (await client.request(
    readItems("patients", {
      filter: { clinic: { _eq: CLINIC_ID } },
      fields: ["identificacion"],
      limit: -1,
    }),
  )) as Pick<PatientRow, "identificacion">[];
  return new Set(rows.map((r) => r.identificacion).filter((v): v is string => !!v));
}

async function main() {
  console.log(`Leyendo ${EXCEL_PATH} ...`);
  const raw = await readExcel();
  console.log(`${raw.length} filas de datos encontradas.\n`);

  const { toImport, omitted } = buildImportRows(raw);

  const existingIds = await fetchExistingIdentificaciones();
  console.log(`Pacientes ya existentes en la clínica destino: ${existingIds.size}\n`);

  const seenPhones = new Map<string, boolean>(); // telefono -> ya tiene titular en este import
  const toCreate: Omit<PatientRow, "id">[] = [];
  let skippedExisting = 0;
  let titularCount = 0;
  let dependienteCount = 0;

  for (const row of toImport) {
    if (existingIds.has(row.identificacion)) {
      skippedExisting++;
      continue;
    }
    const yaTieneTitular = seenPhones.get(row.telefono) ?? false;
    const titular = !yaTieneTitular;
    seenPhones.set(row.telefono, true);
    if (titular) titularCount++;
    else dependienteCount++;

    toCreate.push({
      telefono: row.telefono,
      nombre: row.nombre,
      titular,
      clinic: CLINIC_ID,
      identificacion: row.identificacion,
      correo: row.correo,
      activo: true,
    });
  }

  console.log("Resumen:");
  console.log(`  Total filas en Excel:        ${raw.length}`);
  console.log(`  A crear como titular:        ${titularCount}`);
  console.log(`  A crear como dependiente:    ${dependienteCount}`);
  console.log(`  Saltadas (ya existían):      ${skippedExisting}`);
  console.log(`  Omitidas (teléfono inválido): ${omitted.length}`);

  if (omitted.length > 0) {
    console.log("\nFilas omitidas — requieren revisión manual:");
    for (const o of omitted) {
      console.log(`  · fila ${o.fila}: "${o.nombre}" (cédula ${o.cedula}) — ${o.motivo}`);
    }
  }

  if (DRY_RUN) {
    console.log("\nDry run: no se escribió nada. Corre sin --dry-run para aplicar.");
    return;
  }

  if (toCreate.length === 0) {
    console.log("\nNada que crear.");
    return;
  }

  console.log(`\nCreando ${toCreate.length} pacientes en lotes de ${BATCH_SIZE} ...`);
  for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
    const batch = toCreate.slice(i, i + BATCH_SIZE);
    await client.request(createItems("patients", batch as never));
    console.log(`  ✓ lote ${i / BATCH_SIZE + 1}: ${batch.length} pacientes creados`);
  }

  console.log("\nListo. Revisa la sección Pacientes del panel para esta clínica.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
