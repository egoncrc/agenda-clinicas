/**
 * Fusiona fichas `doctors` duplicadas: dos filas para la misma persona,
 * herencia del modelo viejo donde `doctors.clinic` era M2O (un médico = una
 * fila por clínica). Ahora que existe la tabla puente M2M `clinics_doctors`
 * (ver provision-doctor-clinics.ts) una sola fila puede estar vinculada a
 * varias clínicas, así que la duplicación ya no hace falta — y es activamente
 * peligrosa: `hasOverlap` y el hook `appointments-overlap-guard` deduplican
 * por `doctor.id`, así que con dos ids nada impide agendar a la misma persona
 * a la misma hora en las dos clínicas.
 *
 * Los pares a fusionar están hardcodeados en PAIRS más abajo (confirmados a
 * mano con el usuario: mismos nombres, cuentas Directus distintas, no
 * homónimos). Para cada par, `keep` es la ficha que sobrevive y `drop` la que
 * se fusiona y se borra al final.
 *
 * Uso (idempotente):
 *
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token> npx tsx scripts/merge-duplicate-doctors.ts --dry-run
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token> npx tsx scripts/merge-duplicate-doctors.ts
 *
 * Qué hace, en orden, por cada par:
 *   1. Repunta appointments.doctor, working_hours.doctor, time_off.doctor,
 *      waitlist.doctor y waitlist.oferta_doctor de `drop` a `keep`.
 *   2. Mueve el vínculo clinics_doctors de `drop` a `keep` (repuntando
 *      doctors_id en la fila existente, para no perder specialty/activo). Si
 *      `keep` ya tiene vínculo con esa misma clínica (conflicto), no repunta:
 *      loguea y deja la fila de `drop` para revisión manual, sin borrarla.
 *   3. Verifica que no queden referencias a `drop` (ninguna cita huérfana).
 *      Si algo quedó sin repuntar, aborta ese par sin tocar la cuenta ni
 *      borrar la ficha.
 *   4. Suspende (no borra) la cuenta Directus de `drop.usuario`, para no
 *      perder trazabilidad de quién hizo qué antes de la fusión.
 *   5. Borra la fila `doctors` de `drop`.
 *
 * Reversible hasta el paso 5: todo lo anterior es re-asignar filas existentes,
 * no hay borrado. El paso 5 sí es definitivo (aunque la cuenta suspendida y
 * el historial de appointments/messages siguen intactos bajo `keep`).
 */
import "dotenv/config";
import {
  createDirectus,
  rest,
  staticToken,
  readItems,
  updateItem,
  deleteItem,
  updateUser,
} from "@directus/sdk";

const url = process.env.DIRECTUS_URL;
const token = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !token) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN).");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

const client = createDirectus(url).with(staticToken(token)).with(rest());

interface Pair {
  label: string;
  keep: string;
  drop: string;
  dropUsuario: string;
}

// Confirmado a mano con el usuario el 2026-08-04: mismos nombres, cuentas
// Directus distintas, misma persona en ambos casos. La cuenta que queda
// activa es la de Santa Lucía en los dos pares.
const PAIRS: Pair[] = [
  {
    label: "Dra. Yendry Delgado",
    keep: "474aaebf-3208-41fc-924e-7e77475fec7e", // Santa Lucía, usuario 0a7a279c...
    drop: "99b9b2c0-46d9-480f-99d6-c87809768a5f", // Clínica Principal, usuario 8fa19fe7...
    dropUsuario: "8fa19fe7-44bb-4122-8c81-a0e71bd75580",
  },
  {
    label: "Dr. Rodolfo Sánchez",
    keep: "527439ff-9490-4c51-8796-3fe274c8b1cc", // Santa Lucía, usuario d73cecf7...
    drop: "676270df-814c-4933-90f4-14ebfb193318", // Clínica Principal, usuario 6eb93ddd...
    dropUsuario: "6eb93ddd-e8c9-4cc5-b3a0-bdf6ddc873db",
  },
];

async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  if (DRY_RUN) {
    console.log(`  ~ ${label} (dry-run)`);
    return;
  }
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}`, JSON.stringify((err as { errors?: unknown })?.errors ?? err));
    throw err;
  }
}

async function countRows(collection: string, filter: Record<string, unknown>): Promise<number> {
  const rows = (await client.request(
    readItems(collection as never, { filter, limit: -1, fields: ["id"] } as never),
  )) as { id: string }[];
  return rows.length;
}

/** Repunta todas las filas de `collection` cuyo `field` apunte a `drop`, a `keep`. */
async function repointField(collection: string, field: string, keep: string, drop: string): Promise<void> {
  const rows = (await client.request(
    readItems(collection as never, { filter: { [field]: { _eq: drop } }, limit: -1, fields: ["id"] } as never),
  )) as { id: string }[];
  if (rows.length === 0) {
    console.log(`  · ${collection}.${field}: nada que repuntar`);
    return;
  }
  console.log(`  → ${collection}.${field}: ${rows.length} filas a repuntar`);
  for (const row of rows) {
    await safe(`${collection}.${row.id}.${field} = ${keep}`, () =>
      client.request(updateItem(collection as never, row.id, { [field]: keep } as never)),
    );
  }
}

/** Mueve el vínculo clinics_doctors de `drop` a `keep`. Si `keep` ya tiene vínculo con esa clínica, deja la fila de `drop` intacta y avisa (conflicto manual). */
async function mergeClinicsDoctors(keep: string, drop: string): Promise<boolean> {
  const dropLinks = (await client.request(
    readItems("clinics_doctors" as never, {
      filter: { doctors_id: { _eq: drop } },
      limit: -1,
      fields: ["id", "clinics_id"],
    } as never),
  )) as { id: string; clinics_id: string }[];

  if (dropLinks.length === 0) {
    console.log("  · clinics_doctors: drop no tiene vínculos");
    return true;
  }

  let allResolved = true;
  for (const link of dropLinks) {
    const conflict = (await client.request(
      readItems("clinics_doctors" as never, {
        filter: { doctors_id: { _eq: keep }, clinics_id: { _eq: link.clinics_id } },
        limit: -1,
        fields: ["id"],
      } as never),
    )) as { id: string }[];

    if (conflict.length > 0) {
      console.error(
        `  ✗ clinics_doctors: keep ya tiene vínculo con clínica ${link.clinics_id} — dejo la fila ${link.id} de drop sin tocar, revísalo a mano`,
      );
      allResolved = false;
      continue;
    }

    await safe(`clinics_doctors.${link.id}.doctors_id = ${keep} (clínica ${link.clinics_id})`, () =>
      client.request(updateItem("clinics_doctors" as never, link.id, { doctors_id: keep } as never)),
    );
  }
  return allResolved;
}

async function mergePair(pair: Pair): Promise<void> {
  console.log(`\n=== ${pair.label} (${pair.drop} -> ${pair.keep}) ===`);

  const appointmentsBefore = await countRows("appointments", { doctor: { _eq: pair.drop } });
  console.log(`  citas apuntando a drop antes de fusionar: ${appointmentsBefore}`);

  await repointField("appointments", "doctor", pair.keep, pair.drop);
  await repointField("working_hours", "doctor", pair.keep, pair.drop);
  await repointField("time_off", "doctor", pair.keep, pair.drop);
  await repointField("waitlist", "doctor", pair.keep, pair.drop);
  await repointField("waitlist", "oferta_doctor", pair.keep, pair.drop);
  const clinicsDoctorsOk = await mergeClinicsDoctors(pair.keep, pair.drop);

  if (DRY_RUN) {
    console.log("  (dry-run: se omite verificación de referencias y borrado de la ficha)");
    return;
  }

  const remaining = [
    ["appointments", "doctor", await countRows("appointments", { doctor: { _eq: pair.drop } })],
    ["working_hours", "doctor", await countRows("working_hours", { doctor: { _eq: pair.drop } })],
    ["time_off", "doctor", await countRows("time_off", { doctor: { _eq: pair.drop } })],
    ["waitlist", "doctor", await countRows("waitlist", { doctor: { _eq: pair.drop } })],
    ["waitlist", "oferta_doctor", await countRows("waitlist", { oferta_doctor: { _eq: pair.drop } })],
    ["clinics_doctors", "doctors_id", await countRows("clinics_doctors", { doctors_id: { _eq: pair.drop } })],
  ] as const;

  let blocked = !clinicsDoctorsOk;
  for (const [collection, field, count] of remaining) {
    if (count > 0) {
      console.error(`  ✗ ${collection}.${field}: todavía ${count} filas apuntan a drop`);
      blocked = true;
    }
  }

  if (blocked) {
    console.error(
      `  ✗ ${pair.label}: quedaron referencias sin repuntar — no suspendo la cuenta ni borro la ficha. Resolvé el conflicto y volvé a correr el script (es idempotente).`,
    );
    return;
  }

  const appointmentsAfter = await countRows("appointments", { doctor: { _eq: pair.keep } });
  console.log(`  ✓ sin referencias a drop. citas ahora bajo keep: ${appointmentsAfter}`);

  await safe(`directus_users.${pair.dropUsuario}.status = suspended`, () =>
    client.request(updateUser(pair.dropUsuario, { status: "suspended" } as never)),
  );

  await safe(`borrar doctors.${pair.drop}`, () => client.request(deleteItem("doctors" as never, pair.drop)));
}

async function main() {
  console.log(`Fusionando fichas duplicadas en ${url}${DRY_RUN ? " (DRY RUN, no escribe nada)" : ""} ...`);
  for (const pair of PAIRS) {
    await mergePair(pair);
  }
  console.log(DRY_RUN ? "\nDry run terminado. Corre sin --dry-run para aplicar." : "\nListo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
