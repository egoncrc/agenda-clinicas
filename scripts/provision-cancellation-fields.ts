/**
 * Amplía la colección `appointments` con la trazabilidad de la cancelación que
 * necesita el "Reporte de Cancelaciones" del panel: cuándo se canceló, quién la
 * canceló y por qué.
 *
 * Uso:
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token_admin> npx tsx scripts/provision-cancellation-fields.ts
 *
 * Idempotente igual que provision-directus.ts / provision-patient-fields.ts: si
 * un campo ya existe, lo omite.
 *
 * SIN BACKFILL, A PROPÓSITO: para las citas ya canceladas antes de este script
 * no existe el dato en ninguna parte (no hay `date_updated` ni historial de
 * revisiones), y rellenarlas con la fecha de hoy inventaría una anticipación
 * falsa que después nadie podría distinguir de un dato real. Quedan en NULL y
 * los reportes las muestran como "sin dato".
 *
 * QUIÉN LOS ESCRIBE: el hook `appointment-cancel-stamp-hook` estampa
 * `cancelado_en` y deriva `cancelado_por` de la accountability en CUALQUIER
 * escritura que pase el estado a `cancelada` (panel, bot, admin de Directus,
 * API). Los escritores solo aportan el `motivo_cancelacion`, que el hook no
 * puede adivinar, y pueden sobrescribir `cancelado_por` mandándolo explícito.
 */
import "dotenv/config";
import { createDirectus, rest, staticToken, createField } from "@directus/sdk";

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

/**
 * Valores de `cancelado_por`. Deben coincidir con CANCELLED_BY_VALUES del panel
 * (clinica/src/lib/directus.ts) y con la derivación del hook
 * appointment-cancel-stamp-hook.
 */
export const CANCELLED_BY_CHOICES = ["paciente", "recepcion", "medico", "clinica", "admin"];

const NUEVOS_CAMPOS: FieldDef[] = [
  {
    field: "cancelado_en",
    type: "timestamp",
    meta: {
      interface: "datetime",
      note: "Momento en que se canceló la cita. Lo estampa appointment-cancel-stamp-hook; sirve para calcular la anticipación (inicio - cancelado_en).",
    },
    schema: {},
  },
  {
    field: "cancelado_por",
    type: "string",
    meta: {
      interface: "select-dropdown",
      options: { choices: CANCELLED_BY_CHOICES.map((v) => ({ text: v, value: v })) },
      note: "Quién originó la cancelación. Lo deriva appointment-cancel-stamp-hook de la accountability salvo que el escritor lo mande explícito.",
    },
    schema: {},
  },
  {
    field: "motivo_cancelacion",
    type: "text",
    meta: {
      interface: "input-multiline",
      note: "Texto libre. Es el único de los tres que el hook no puede adivinar: lo aporta quien cancela.",
    },
    schema: {},
  },
];

async function main() {
  console.log(`Provisionando campos de cancelación en ${url} ...`);
  await ensureFields("appointments", NUEVOS_CAMPOS);

  console.log("\nListo. Sin backfill a propósito: las citas canceladas antes de este script quedan en NULL.");
  console.log("Siguiente paso: desplegar directus-extensions/appointment-cancel-stamp-hook.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
