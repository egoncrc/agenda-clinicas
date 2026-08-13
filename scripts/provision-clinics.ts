/**
 * Provisiona el esquema multi-clínica en Directus: colección `clinics`,
 * campo `clinic` (M2O) en las colecciones que necesitan aislarse por
 * clínica, y la relación M2M `clinics` <-> `directus_users` (para que una
 * recepcionista pueda estar vinculada a varias clínicas).
 *
 * Uso:
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token_admin> npx tsx scripts/provision-clinics.ts
 *
 * Idempotente igual que provision-directus.ts: si algo ya existe, lo omite.
 * Al final hace backfill de todas las filas existentes hacia una clínica
 * por defecto ("Clínica Principal") y solo entonces marca `clinic` como
 * obligatorio — así una corrida sobre datos ya existentes no rompe nada.
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

/**
 * Campo alias (sin columna propia) que representa el lado "muchos" de una
 * relación O2M/M2M — necesario crearlo explícito ANTES de que la relación lo
 * referencie via meta.one_field (mismo orden ya usado y documentado en este
 * proyecto para el alias reverso patients.appointments, ver CLAUDE.md).
 */
async function ensureAlias(
  collection: string,
  field: string,
  kind: "o2m" | "m2m",
  note: string,
) {
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

/**
 * Crea un campo M2O y su relación con la colección destino. Si se pasa
 * `oneField`, primero asegura el alias O2M reverso en `related` y liga la
 * relación a él (meta.one_field) para poder navegar/filtrar en sentido
 * inverso (ej. permisos de Directus con dot-path relacional).
 */
async function ensureM2O(
  collection: string,
  field: string,
  related: string,
  onDelete: "SET NULL" | "CASCADE" | "RESTRICT" = "RESTRICT",
  oneField?: string,
  oneFieldNote?: string,
) {
  if (oneField) {
    await ensureAlias(related, oneField, "o2m", oneFieldNote ?? `Reverso de ${collection}.${field}`);
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
        meta: (oneField ? { one_field: oneField } : {}) as never,
      }),
    ),
  );
}

/** Marca un campo existente como obligatorio (NOT NULL) — se llama solo después del backfill. */
async function makeRequired(collection: string, field: string) {
  await safe(`  ${collection}.${field} -> requerido`, () =>
    client.request(
      updateField(collection, field, {
        schema: { is_nullable: false } as never,
      } as never),
    ),
  );
}

/**
 * `doctors` NO está acá: un médico puede trabajar en varias clínicas, así que
 * su vínculo es M2M y lo provisiona `provision-doctor-clinics.ts`.
 */
const CLINIC_SCOPED_COLLECTIONS = ["services", "patients", "appointments", "waitlist"] as const;

async function main() {
  console.log(`Provisionando esquema multi-clínica en ${url} ...`);

  // ---- Colección clinics ----
  await ensureCollection("clinics", "storefront", "Clínicas (multi-tenant)");
  await ensureFields("clinics", [
    { field: "nombre", type: "string", meta: { interface: "input" }, schema: {} },
    { field: "activo", type: "boolean", schema: { default_value: true }, meta: { interface: "boolean" } },
    {
      field: "zona_horaria",
      type: "string",
      meta: { interface: "input", note: "IANA tz, ej. America/Costa_Rica. Vacío = usa CLINIC_TIMEZONE global." },
      schema: {},
    },
    {
      field: "whatsapp_numero",
      type: "string",
      meta: { interface: "input", note: "Número E.164 que recibe los mensajes de esta clínica (whatsappInboundMessage.to). Vacío = clínica por defecto (fallback si no hay match)." },
      schema: {},
    },
    {
      field: "ycloud_api_key",
      type: "string",
      meta: { interface: "input", note: "Vacío = usa YCLOUD_API_KEY global." },
      schema: {},
    },
    {
      field: "ycloud_webhook_secret",
      type: "string",
      meta: { interface: "input", note: "Vacío = usa YCLOUD_WEBHOOK_SECRET global." },
      schema: {},
    },
    {
      field: "booking_public_link_token",
      type: "string",
      meta: { interface: "input", note: "Vacío = usa BOOKING_PUBLIC_LINK_TOKEN global." },
      schema: {},
    },
    {
      field: "telefono_contacto",
      type: "string",
      meta: { interface: "input", note: "Teléfono de contacto visible al paciente en los mensajes (distinto de whatsapp_numero, que es el número de envío de la API)." },
      schema: {},
    },
  ]);

  // ---- Campo M2O clinic en cada colección que se aísla por clínica ----
  await ensureM2O("specialties", "clinic", "clinics", "RESTRICT", "especialidades", "Especialidades de esta clínica");
  await ensureM2O("services", "clinic", "clinics", "RESTRICT", "servicios", "Servicios de esta clínica");
  await ensureM2O("patients", "clinic", "clinics", "RESTRICT", "pacientes", "Pacientes de esta clínica");
  await ensureM2O("appointments", "clinic", "clinics", "RESTRICT", "citas", "Citas de esta clínica");
  await ensureM2O("waitlist", "clinic", "clinics", "RESTRICT", "lista_espera", "Entradas de lista de espera de esta clínica");

  // ---- M2M clinics <-> directus_users (recepcionistas) ----
  await ensureCollection("clinics_directus_users", "group", "Vínculo recepcionista <-> clínica (M2M)");
  await ensureAlias("clinics", "recepcionistas", "m2m", "Recepcionistas vinculadas a esta clínica");
  await ensureAlias("directus_users", "clinics", "m2m", "Clínicas a las que está vinculado este usuario (recepcionistas)");
  await ensureM2O("clinics_directus_users", "clinics_id", "clinics", "CASCADE");
  await safe("  relación clinics_directus_users.clinics_id -> clinics (one_field=recepcionistas)", () =>
    client.request(
      createRelation({
        collection: "clinics_directus_users",
        field: "clinics_id",
        related_collection: "clinics",
        schema: { on_delete: "CASCADE" } as never,
        meta: { one_field: "recepcionistas", junction_field: "directus_users_id" } as never,
      }),
    ),
  );
  await safe("  campo M2O clinics_directus_users.directus_users_id", () =>
    client.request(
      createField("clinics_directus_users", {
        field: "directus_users_id",
        type: "uuid",
        meta: { interface: "select-dropdown-m2o", special: [] },
        schema: {},
      } as never),
    ),
  );
  await safe("  relación clinics_directus_users.directus_users_id -> directus_users (one_field=clinics)", () =>
    client.request(
      createRelation({
        collection: "clinics_directus_users",
        field: "directus_users_id",
        related_collection: "directus_users",
        schema: { on_delete: "CASCADE" } as never,
        meta: { one_field: "clinics", junction_field: "clinics_id" } as never,
      }),
    ),
  );
  // Bloqueo de acceso por clínica sin afectar otras clínicas donde la misma
  // cuenta esté vinculada (ver RECEPTIONIST_CLINIC_CONDITION en
  // provision-clinic-permissions.ts). `default_value: true` también aplica a
  // las filas ya existentes, nadie queda bloqueado por sorpresa al correr esto.
  await ensureFields("clinics_directus_users", [
    { field: "activo", type: "boolean", schema: { default_value: true }, meta: { interface: "boolean" } },
  ]);

  // ---- Backfill: clínica por defecto + asignar filas existentes sin clinic ----
  console.log("\nBackfill de clínica por defecto...");
  const existing = await client.request(
    readItems("clinics" as never, { limit: 1 } as never),
  ) as { id: string }[];

  let defaultClinicId = existing[0]?.id;
  if (!defaultClinicId) {
    const created = (await client.request(
      createItem("clinics" as never, { nombre: "Clínica Principal", activo: true } as never),
    )) as { id: string };
    defaultClinicId = created.id;
    console.log(`  ✓ creada "Clínica Principal" (${defaultClinicId})`);
  } else {
    console.log(`  · ya existe al menos una clínica, uso "${defaultClinicId}" como destino del backfill`);
  }

  for (const collection of CLINIC_SCOPED_COLLECTIONS) {
    const rows = (await client.request(
      readItems(collection as never, { filter: { clinic: { _null: true } }, limit: -1, fields: ["id"] } as never),
    )) as { id: string }[];
    if (rows.length === 0) {
      console.log(`  · ${collection}: nada que backfillear`);
      continue;
    }
    for (const row of rows) {
      await safe(`  ${collection}.${row.id}.clinic = ${defaultClinicId}`, () =>
        client.request(updateItem(collection as never, row.id, { clinic: defaultClinicId } as never)),
      );
    }
  }

  console.log("\nMarcando clinic como obligatorio (post-backfill)...");
  for (const collection of CLINIC_SCOPED_COLLECTIONS) {
    await makeRequired(collection, "clinic");
  }

  // ---- Backfill de especialidad por defecto ("Odontología" por clínica) ----
  // Cada clínica recibe su propia "Odontología" (specialty es clinic-scoped),
  // y todo médico/servicio sin especialidad se asigna a la de SU clínica.
  console.log("\nBackfill de especialidad por defecto (Odontología por clínica)...");
  const allClinics = (await client.request(
    readItems("clinics" as never, { limit: -1, fields: ["id"] } as never),
  )) as { id: string }[];

  const odontologiaByClinic = new Map<string, string>();
  for (const c of allClinics) {
    const existingSpec = (await client.request(
      readItems("specialties" as never, {
        filter: { nombre: { _eq: "Odontología" }, clinic: { _eq: c.id } },
        limit: 1,
        fields: ["id"],
      } as never),
    )) as { id: string }[];
    let specId = existingSpec[0]?.id;
    if (!specId) {
      const created = (await client.request(
        createItem("specialties" as never, { nombre: "Odontología", activo: true, clinic: c.id } as never),
      )) as { id: string };
      specId = created.id;
      console.log(`  ✓ Odontología creada para clínica ${c.id} (${specId})`);
    } else {
      console.log(`  · Odontología ya existía para clínica ${c.id}`);
    }
    odontologiaByClinic.set(c.id, specId);
  }

  // `doctors` no aparece acá: su especialidad depende de la clínica y vive en
  // `clinics_doctors.specialty` (provision-doctor-clinics.ts la backfillea).
  for (const collection of ["services"] as const) {
    const rows = (await client.request(
      readItems(collection as never, {
        filter: { specialty: { _null: true } },
        limit: -1,
        fields: ["id", "clinic"],
      } as never),
    )) as { id: string; clinic: string }[];
    if (rows.length === 0) {
      console.log(`  · ${collection}: nada que backfillear (specialty)`);
      continue;
    }
    for (const row of rows) {
      const specId = odontologiaByClinic.get(row.clinic);
      if (!specId) {
        console.error(`  ✗ ${collection}.${row.id}: sin Odontología para clínica ${row.clinic}`);
        continue;
      }
      await safe(`  ${collection}.${row.id}.specialty = ${specId}`, () =>
        client.request(updateItem(collection as never, row.id, { specialty: specId } as never)),
      );
    }
  }

  console.log("\nMarcando specialty/clinic como obligatorio (post-backfill)...");
  await makeRequired("specialties", "clinic");
  await makeRequired("services", "specialty");

  console.log("\nListo. Revisa la colección `clinics`, `specialties` y los campos `clinic`/`specialty` en el panel de Directus.");
  console.log("Siguiente: `provision-doctor-clinics.ts` (vínculo médico <-> clínica) y después `provision-clinic-permissions.ts`.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
