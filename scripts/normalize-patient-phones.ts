/**
 * Recorta el prefijo +506 de `patients.telefono` en todas las clínicas: la
 * convención pasó de E.164 (`+50688121373`) a local de 8 dígitos
 * (`88121373`), igual que ahora escriben `src/server.ts`/`publicBooking.ts`
 * (ver `src/domain/phone.ts`). Sin este backfill, las fichas creadas antes
 * del cambio quedan con +506 y el bot/panel no las encuentran por número
 * (crean paciente duplicado en vez de reconocer al existente).
 *
 * Idempotente: una fila ya en formato local (8 dígitos) se salta.
 *
 * Uso:
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token_admin> npx tsx scripts/normalize-patient-phones.ts --dry-run
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token_admin> npx tsx scripts/normalize-patient-phones.ts
 */
import "dotenv/config";
import { createDirectus, rest, staticToken, readItems, updateItem } from "@directus/sdk";
import { toLocalPhone } from "../src/domain/phone.js";

const url = process.env.DIRECTUS_URL;
const token = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !token) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN).");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

const client = createDirectus(url).with(staticToken(token)).with(rest());

interface Row {
  id: string;
  telefono: string;
}

async function main() {
  console.log(`Normalizando patients.telefono en ${url}${DRY_RUN ? " (DRY RUN, no escribe nada)" : ""} ...`);

  const rows = (await client.request(
    readItems("patients" as never, { limit: -1, fields: ["id", "telefono"] } as never),
  )) as Row[];

  let cambiados = 0;
  let sinCambio = 0;
  let irreconocibles = 0;

  for (const row of rows) {
    const local = toLocalPhone(row.telefono ?? "");
    if (local === row.telefono) {
      sinCambio++;
      continue;
    }
    if (local.length !== 8) {
      // No es el caso local CR ni el E.164 +506 esperado (ej. número extranjero
      // o dato corrupto): se lista para revisión manual, no se toca.
      console.warn(`  ? ${row.id}: "${row.telefono}" -> "${local}" (no queda en 8 dígitos, revisar a mano)`);
      irreconocibles++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  ~ ${row.id}: "${row.telefono}" -> "${local}" (dry-run)`);
    } else {
      await client.request(updateItem("patients" as never, row.id, { telefono: local } as never));
      console.log(`  ✓ ${row.id}: "${row.telefono}" -> "${local}"`);
    }
    cambiados++;
  }

  console.log(
    `\nTotal: ${rows.length} pacientes. ${cambiados} ${DRY_RUN ? "a cambiar" : "cambiados"}, ${sinCambio} ya en formato local, ${irreconocibles} para revisión manual.`,
  );
  console.log(DRY_RUN ? "Dry run terminado. Corre sin --dry-run para aplicar." : "Listo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
