/**
 * Amplía la colección `patients` con los campos de la ficha completa que
 * mantiene la pantalla "Pacientes" del panel: correo, identificación,
 * dirección (provincia/cantón/distrito de Costa Rica + señas exactas) y la
 * bandera `activo` de baja lógica.
 *
 * Uso:
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token_admin> npm run provision:patients
 *
 * Idempotente igual que provision-directus.ts / provision-clinics.ts: si un
 * campo ya existe, lo omite.
 *
 * BAJA LÓGICA, NO BORRADO: `appointments.patient`, `messages.patient` y
 * `waitlist.patient` son ON DELETE CASCADE, así que borrar un paciente se
 * llevaría su historial completo. Por eso la pantalla solo pone
 * `activo: false` (y solo el administrador puede hacerlo — ver
 * scripts/provision-clinic-permissions.ts).
 *
 * El backfill del final es obligatorio: el `default_value` de una columna
 * nueva solo aplica a filas nuevas, las existentes quedan en NULL. Aun así,
 * el código de la app filtra con `activo: { _neq: false }` (no `_eq: true`)
 * para tolerar filas creadas fuera de este script.
 */
import "dotenv/config";
import { createDirectus, rest, staticToken, createField, readItems, updateItem } from "@directus/sdk";

const url = process.env.DIRECTUS_URL;
const token = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !token) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN).");
  process.exit(1);
}

const client = createDirectus(url).with(staticToken(token)).with(rest());

function isAlreadyExists(err: unknown): boolean {
  const msg = JSON.stringify((err as { errors?: unknown })?.errors ?? err ?? "");
  return /exist|duplicate|already/i.test(msg);
}

async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    if (isAlreadyExists(err)) {
      console.log(`  · ${label} (ya existía)`);
    } else {
      console.error(`  ✗ ${label}`, JSON.stringify((err as { errors?: unknown })?.errors ?? err));
    }
  }
}

type FieldDef = {
  field: string;
  type: string;
  meta?: Record<string, unknown>;
  schema?: Record<string, unknown>;
};

async function ensureFields(collection: string, fields: FieldDef[]) {
  for (const f of fields) {
    await safe(`  campo ${collection}.${f.field}`, () => client.request(createField(collection, f as never)));
  }
}

// Provincia/cantón/distrito se guardan como TEXTO (el nombre), no como código:
// se leen tal cual en el admin de Directus y en cualquier export, y la lista
// oficial (clinica/src/lib/costaRica.ts) vive del lado del panel.
const NUEVOS_CAMPOS: FieldDef[] = [
  { field: "identificacion", type: "string", meta: { interface: "input", note: "Cédula u otro documento. Opcional; el panel avisa si se repite dentro de la misma clínica." }, schema: {} },
  { field: "correo", type: "string", meta: { interface: "input" }, schema: {} },
  { field: "provincia", type: "string", meta: { interface: "input", note: "Nombre de la provincia (División Territorial Administrativa de Costa Rica)" }, schema: {} },
  { field: "canton", type: "string", meta: { interface: "input" }, schema: {} },
  { field: "distrito", type: "string", meta: { interface: "input" }, schema: {} },
  { field: "direccion", type: "text", meta: { interface: "input-multiline", note: "Señas exactas" }, schema: {} },
  {
    field: "activo",
    type: "boolean",
    meta: { interface: "boolean", note: "Baja lógica: false = paciente dado de baja. No se borra nunca para no perder su historial de citas (ON DELETE CASCADE)." },
    schema: { default_value: true },
  },
];

async function main() {
  console.log(`Provisionando campos de patients en ${url} ...`);
  await ensureFields("patients", NUEVOS_CAMPOS);

  console.log("\nBackfill de activo = true en pacientes existentes...");
  const rows = (await client.request(
    readItems("patients" as never, { filter: { activo: { _null: true } }, limit: -1, fields: ["id"] } as never),
  )) as { id: string }[];

  if (rows.length === 0) {
    console.log("  · nada que backfillear");
  } else {
    for (const row of rows) {
      await safe(`  patients.${row.id}.activo = true`, () =>
        client.request(updateItem("patients" as never, row.id, { activo: true } as never)),
      );
    }
  }

  console.log("\nListo. Corré después scripts/provision-clinic-permissions.ts para acotar los permisos de `patients`.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
