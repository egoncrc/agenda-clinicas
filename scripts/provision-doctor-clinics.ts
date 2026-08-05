/**
 * Médico multi-clínica. Reemplaza el M2O `doctors.clinic` (un médico = una
 * clínica) por la tabla puente M2M `clinics_doctors`, y le da campo `clinic`
 * propio a `working_hours` y `time_off` para que el mismo médico pueda tener
 * horario y ausencias distintas en cada clínica donde trabaja.
 *
 * Por qué una sola fila `doctors` por persona (y no una por clínica): así
 * `hasOverlap` (src/domain/availability.ts), `bookAppointment`/
 * `rescheduleAppointment` (src/repositories/appointments.ts) y la extensión
 * `appointments-overlap-guard` siguen viendo un único `doctor.id`, y el
 * sistema sigue impidiendo que agenden al mismo médico a la misma hora en dos
 * clínicas distintas. Con filas duplicadas serían dos ids y nada lo impediría.
 *
 * Uso (idempotente, en este orden y con un deploy de código en medio):
 *
 *   # 1. Ver qué haría, sin escribir nada
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token> npx tsx scripts/provision-doctor-clinics.ts --dry-run
 *
 *   # 2. Esquema aditivo + backfill (el código viejo sigue funcionando: solo agrega columnas)
 *   ... npx tsx scripts/provision-doctor-clinics.ts
 *
 *   # 3. NOT NULL en lo nuevo + aflojar lo viejo. VA ANTES de desplegar el código nuevo,
 *   #    que ya no escribe doctors.clinic/doctors.specialty. Aborta si quedó algún nulo.
 *   ... npx tsx scripts/provision-doctor-clinics.ts --finalize
 *
 *   # 4. (deploy del bot, las extensiones y el panel + provision-clinic-permissions.ts)
 *
 *   # 5. Días después, con todo verificado: borra las columnas viejas. NO reversible.
 *   ... npx tsx scripts/provision-doctor-clinics.ts --drop-legacy
 *
 * Hasta el paso 5 todo se revierte re-desplegando el código anterior: las
 * columnas viejas siguen pobladas.
 *
 * NOTA: la API de campos de Directus no expone índices compuestos, así que la
 * unicidad de (clinics_id, doctors_id) la garantiza este script consultando
 * antes de insertar. Para endurecerla de verdad, en psql:
 *   ALTER TABLE clinics_doctors ADD CONSTRAINT clinics_doctors_unique UNIQUE (clinics_id, doctors_id);
 */
import "dotenv/config";
import {
  createDirectus,
  rest,
  staticToken,
  createCollection,
  createField,
  createRelation,
  updateField,
  deleteField,
  readItems,
  createItem,
  updateItem,
} from "@directus/sdk";

const url = process.env.DIRECTUS_URL;
const token = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !token) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN).");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const FINALIZE = process.argv.includes("--finalize");
const DROP_LEGACY = process.argv.includes("--drop-legacy");

const client = createDirectus(url).with(staticToken(token)).with(rest());

function isAlreadyExists(err: unknown): boolean {
  const msg = JSON.stringify((err as { errors?: unknown })?.errors ?? err ?? "");
  return /exist|duplicate|already/i.test(msg);
}

async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  if (DRY_RUN) {
    console.log(`  ~ ${label} (dry-run)`);
    return;
  }
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

async function ensureCollection(collection: string, icon: string, note: string) {
  await safe(`colección ${collection}`, () =>
    client.request(
      createCollection({
        collection,
        meta: { icon, note },
        schema: {},
        fields: [
          {
            field: "id",
            type: "uuid",
            meta: { hidden: true, readonly: true, interface: "input", special: ["uuid"] },
            schema: { is_primary_key: true, has_auto_increment: false },
          },
        ],
      }),
    ),
  );
}

type FieldDef = {
  field: string;
  type: string;
  meta?: Record<string, unknown>;
  schema?: Record<string, unknown>;
};

async function ensureFields(collection: string, fields: FieldDef[]) {
  for (const f of fields) {
    await safe(`  campo ${collection}.${f.field}`, () =>
      client.request(createField(collection, f as never)),
    );
  }
}

/** Campo alias (sin columna propia) del lado "muchos" de una O2M/M2M. Debe existir ANTES de que la relación lo referencie via meta.one_field. */
async function ensureAlias(collection: string, field: string, kind: "o2m" | "m2m", note: string) {
  await safe(`  campo alias ${collection}.${field}`, () =>
    client.request(
      createField(collection, {
        field,
        type: "alias",
        meta: {
          special: [kind],
          interface: kind === "m2m" ? "list-m2m" : "list-o2m",
          note,
        },
      } as never),
    ),
  );
}

/** Campo M2O + su relación. Con `oneField` asegura además el alias reverso y lo liga (meta.one_field), que es lo que habilita el dot-path en los filtros de permisos. */
async function ensureM2O(
  collection: string,
  field: string,
  related: string,
  onDelete: "SET NULL" | "CASCADE" | "RESTRICT" = "RESTRICT",
  oneField?: string,
  oneFieldNote?: string,
  junctionField?: string,
) {
  if (oneField) {
    await ensureAlias(related, oneField, junctionField ? "m2m" : "o2m", oneFieldNote ?? `Reverso de ${collection}.${field}`);
  }
  await safe(`  campo M2O ${collection}.${field}`, () =>
    client.request(
      createField(collection, {
        field,
        type: "uuid",
        meta: { interface: "select-dropdown-m2o", special: [] },
        schema: {},
      } as never),
    ),
  );
  await safe(`  relación ${collection}.${field} -> ${related}`, () =>
    client.request(
      createRelation({
        collection,
        field,
        related_collection: related,
        schema: { on_delete: onDelete } as never,
        meta: (oneField
          ? junctionField
            ? { one_field: oneField, junction_field: junctionField }
            : { one_field: oneField }
          : {}) as never,
      }),
    ),
  );
}

async function setNullable(collection: string, field: string, isNullable: boolean) {
  await safe(`  ${collection}.${field} -> ${isNullable ? "opcional" : "requerido"}`, () =>
    client.request(updateField(collection, field, { schema: { is_nullable: isNullable } as never } as never)),
  );
}

/** Cuenta filas que cumplen un filtro (sin traerlas todas: solo el id). */
async function countRows(collection: string, filter: Record<string, unknown>): Promise<number> {
  const rows = (await client.request(
    readItems(collection as never, { filter, limit: -1, fields: ["id"] } as never),
  )) as { id: string }[];
  return rows.length;
}

interface DoctorLegacyRow {
  id: string;
  clinic: string | null;
  specialty: string | null;
  activo: boolean;
}

// ---------------------------------------------------------------------------

async function phaseSchema() {
  console.log("\n[1/2] Esquema aditivo (todo nullable, el código viejo sigue funcionando)...");

  // ---- Tabla puente clinics_doctors ----
  await ensureCollection("clinics_doctors", "group", "Vínculo médico <-> clínica (M2M). Un médico puede trabajar en varias clínicas.");
  await ensureAlias("clinics", "medicos", "m2m", "Médicos que trabajan en esta clínica");
  await ensureAlias("doctors", "clinicas", "m2m", "Clínicas en las que trabaja este médico");
  await ensureM2O("clinics_doctors", "clinics_id", "clinics", "CASCADE", "medicos", undefined, "doctors_id");
  await ensureM2O("clinics_doctors", "doctors_id", "doctors", "CASCADE", "clinicas", undefined, "clinics_id");
  // Especialidad POR CLÍNICA: `specialties` es clinic-scoped, así que la
  // especialidad del médico no puede vivir en `doctors` si trabaja en varias.
  await ensureM2O("clinics_doctors", "specialty", "specialties", "RESTRICT");
  // `activo` del vínculo: desactivar al médico en una clínica sin tocar la otra
  // (mismo criterio que clinics_directus_users.activo). La regla efectiva pasa
  // a ser `doctors.activo && clinics_doctors.activo`.
  await ensureFields("clinics_doctors", [
    { field: "activo", type: "boolean", schema: { default_value: true }, meta: { interface: "boolean" } },
  ]);

  // ---- clinic propio en working_hours / time_off ----
  // Antes se derivaban de `doctor.clinic`; con un médico en N clínicas eso ya
  // no identifica nada, y son justo las dos colecciones que deben poder diferir
  // por sede (horario distinto, ausencia que bloquea solo una clínica).
  await ensureM2O("working_hours", "clinic", "clinics", "RESTRICT", "horarios", "Horarios de atención en esta clínica");
  await ensureM2O("time_off", "clinic", "clinics", "RESTRICT", "ausencias", "Ausencias declaradas en esta clínica");
}

async function phaseBackfill() {
  console.log("\n[2/2] Backfill desde el esquema viejo...");

  // Instalación nueva (o ya migrada y sin médicos): no hay nada que traer del
  // esquema viejo, y `doctors.clinic`/`doctors.specialty` puede que ni existan.
  const doctorIds = (await client.request(
    readItems("doctors" as never, { limit: -1, fields: ["id"] } as never),
  )) as { id: string }[];
  if (doctorIds.length === 0) {
    console.log("  · no hay médicos: nada que backfillear");
    return;
  }

  let doctors: DoctorLegacyRow[];
  try {
    doctors = (await client.request(
      readItems("doctors" as never, {
        limit: -1,
        fields: ["id", "clinic", "specialty", "activo"],
      } as never),
    )) as DoctorLegacyRow[];
  } catch (err) {
    console.error(
      "  ✗ No se pudo leer doctors.clinic/doctors.specialty — ¿ya corriste --drop-legacy? El backfill solo tiene sentido antes de eso.",
      JSON.stringify((err as { errors?: unknown })?.errors ?? err),
    );
    process.exit(1);
  }

  // Vínculos ya existentes, para no duplicar (la unicidad no está en el esquema).
  // En --dry-run la colección puede no existir todavía (la fase de esquema no
  // escribió nada): se asume vacía y se reportan todos los vínculos como nuevos.
  let existingLinks: { clinics_id: string; doctors_id: string }[] = [];
  try {
    existingLinks = (await client.request(
      readItems("clinics_doctors" as never, { limit: -1, fields: ["clinics_id", "doctors_id"] } as never),
    )) as { clinics_id: string; doctors_id: string }[];
  } catch (err) {
    if (!DRY_RUN) throw err;
    console.log("  · clinics_doctors todavía no existe (dry-run): se asume sin vínculos");
  }
  const linked = new Set(existingLinks.map((l) => `${l.clinics_id}::${l.doctors_id}`));

  let created = 0;
  let skipped = 0;
  for (const d of doctors) {
    if (!d.clinic) {
      console.error(`  ✗ doctors.${d.id} sin clinic — imposible de backfillear, revísalo a mano`);
      continue;
    }
    if (linked.has(`${d.clinic}::${d.id}`)) {
      skipped++;
      continue;
    }
    created++;
    // `activo` se COPIA, no se deja en el default `true`: un médico ya inactivo
    // no debe revivir en su clínica por efecto de la migración.
    await safe(`  vínculo clínica ${d.clinic} <-> médico ${d.id}`, () =>
      client.request(
        createItem("clinics_doctors" as never, {
          clinics_id: d.clinic,
          doctors_id: d.id,
          specialty: d.specialty,
          activo: d.activo,
        } as never),
      ),
    );
  }
  console.log(`  → ${doctors.length} médicos: ${created} vínculos a crear, ${skipped} ya existían`);

  // Mapa doctor -> clínica vieja, para derivar el `clinic` de horarios y ausencias.
  const clinicByDoctor = new Map(doctors.map((d) => [d.id, d.clinic]));

  for (const collection of ["working_hours", "time_off"] as const) {
    let rows: { id: string; doctor: string }[];
    try {
      rows = (await client.request(
        readItems(collection as never, {
          filter: { clinic: { _null: true } },
          limit: -1,
          fields: ["id", "doctor"],
        } as never),
      )) as { id: string; doctor: string }[];
    } catch (err) {
      if (!DRY_RUN) throw err;
      // El campo `clinic` todavía no existe: en la corrida real se backfillearía todo.
      const todas = (await client.request(
        readItems(collection as never, { limit: -1, fields: ["id", "doctor"] } as never),
      )) as { id: string; doctor: string }[];
      rows = todas;
    }

    if (rows.length === 0) {
      console.log(`  · ${collection}: nada que backfillear`);
      continue;
    }
    console.log(`  → ${collection}: ${rows.length} filas sin clinic`);
    for (const row of rows) {
      const clinicId = clinicByDoctor.get(row.doctor);
      if (!clinicId) {
        console.error(`  ✗ ${collection}.${row.id}: su médico ${row.doctor} no tiene clínica`);
        continue;
      }
      await safe(`  ${collection}.${row.id}.clinic = ${clinicId}`, () =>
        client.request(updateItem(collection as never, row.id, { clinic: clinicId } as never)),
      );
    }
  }
}

async function phaseFinalize() {
  console.log("\n[--finalize] Verificando que no quedaron nulos...");

  // Se verifica ANTES de marcar NOT NULL: si no, Postgres falla con un error
  // opaco y queda la mitad del esquema a medio migrar.
  const pending = [
    ["clinics_doctors", "clinics_id", await countRows("clinics_doctors", { clinics_id: { _null: true } })],
    ["clinics_doctors", "doctors_id", await countRows("clinics_doctors", { doctors_id: { _null: true } })],
    ["clinics_doctors", "specialty", await countRows("clinics_doctors", { specialty: { _null: true } })],
    ["working_hours", "clinic", await countRows("working_hours", { clinic: { _null: true } })],
    ["time_off", "clinic", await countRows("time_off", { clinic: { _null: true } })],
  ] as const;

  let blocked = false;
  for (const [collection, field, count] of pending) {
    if (count > 0) {
      console.error(`  ✗ ${collection}.${field}: ${count} filas en null`);
      blocked = true;
    } else {
      console.log(`  ✓ ${collection}.${field}: sin nulos`);
    }
  }

  // Un médico sin vínculo desaparece del catálogo del panel y de
  // listActiveDoctors del bot, y getDoctor le lanza "Médico no encontrado".
  const doctorCount = await countRows("doctors", {});
  const linkedDoctors = new Set(
    ((await client.request(
      readItems("clinics_doctors" as never, { limit: -1, fields: ["doctors_id"] } as never),
    )) as { doctors_id: string }[]).map((l) => l.doctors_id),
  );
  if (linkedDoctors.size < doctorCount) {
    console.error(`  ✗ ${doctorCount - linkedDoctors.size} médicos sin ningún vínculo en clinics_doctors`);
    blocked = true;
  } else {
    console.log(`  ✓ los ${doctorCount} médicos tienen al menos un vínculo`);
  }

  if (blocked) {
    console.error("\nAbortado: corre el backfill (sin flags) y vuelve a intentar.");
    process.exit(1);
  }

  console.log("\nMarcando lo nuevo como obligatorio...");
  await setNullable("clinics_doctors", "clinics_id", false);
  await setNullable("clinics_doctors", "doctors_id", false);
  await setNullable("clinics_doctors", "specialty", false);
  await setNullable("working_hours", "clinic", false);
  await setNullable("time_off", "clinic", false);

  console.log("\nAflojando lo viejo (el código nuevo ya no escribe estos campos)...");
  await setNullable("doctors", "clinic", true);
  await setNullable("doctors", "specialty", true);

  console.log("\nListo. Ahora sí: despliega el bot, las extensiones y el panel, y corre provision-clinic-permissions.ts.");
}

async function phaseDropLegacy() {
  console.log("\n[--drop-legacy] Borrando el esquema viejo. ESTO NO SE REVIERTE.");
  for (const [collection, field] of [
    ["doctors", "clinic"],
    ["doctors", "specialty"],
    ["clinics", "doctores"], // alias O2M huérfano de doctors.clinic
  ] as const) {
    await safe(`  borrar ${collection}.${field}`, () => client.request(deleteField(collection, field)));
  }
}

async function main() {
  console.log(`Provisionando médico multi-clínica en ${url}${DRY_RUN ? " (DRY RUN, no escribe nada)" : ""} ...`);

  if (DROP_LEGACY) {
    await phaseDropLegacy();
  } else if (FINALIZE) {
    await phaseFinalize();
  } else {
    await phaseSchema();
    await phaseBackfill();
    console.log(
      DRY_RUN
        ? "\nDry run terminado. Corre sin --dry-run para aplicar, y después --finalize."
        : "\nListo. Verifica los conteos de arriba y corre --finalize cuando no queden nulos.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
