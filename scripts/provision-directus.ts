/**
 * Provisiona el esquema de colecciones en Directus para la agenda dental.
 *
 * Uso:
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token_admin> npm run provision
 *
 * Requiere un token de un usuario con permisos de administración de esquema
 * (crear colecciones/campos/relaciones). Es idempotente: si una colección o
 * campo ya existe, lo omite y continúa.
 */
import "dotenv/config";
import {
  createDirectus,
  rest,
  staticToken,
  createCollection,
  createField,
  createRelation,
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

/** Crea una colección con PK uuid si no existe. */
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

/** Crea un campo M2O y su relación con la colección destino. */
async function ensureM2O(
  collection: string,
  field: string,
  related: string,
  onDelete: "SET NULL" | "CASCADE" | "RESTRICT" = "RESTRICT",
) {
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
        meta: {} as never,
      }),
    ),
  );
}

async function main() {
  console.log(`Provisionando esquema en ${url} ...`);

  // Especialidades: deben existir antes que los M2O `specialty` que las apuntan.
  await ensureCollection("specialties", "medical_information", "Especialidades de la clínica (ej. Odontología, Cardiología)");
  await ensureFields("specialties", [
    { field: "nombre", type: "string", meta: { interface: "input" }, schema: {} },
    { field: "activo", type: "boolean", schema: { default_value: true }, meta: { interface: "boolean" } },
  ]);

  // Identidad del médico. Las clínicas donde trabaja, y la especialidad que
  // tiene en cada una, viven en la tabla puente `clinics_doctors`
  // (provision-doctor-clinics.ts): un mismo médico puede atender en varias.
  await ensureCollection("doctors", "person", "Médicos (una fila por persona, atienda en una clínica o en varias)");
  await ensureFields("doctors", [
    { field: "nombre", type: "string", meta: { interface: "input" }, schema: {} },
    { field: "activo", type: "boolean", schema: { default_value: true }, meta: { interface: "boolean" } },
  ]);

  await ensureCollection("services", "medical_services", "Servicios de la clínica y su duración");
  await ensureFields("services", [
    { field: "nombre", type: "string", meta: { interface: "input" }, schema: {} },
    { field: "duracion_min", type: "integer", meta: { interface: "input", note: "Duración de la cita en minutos" }, schema: { default_value: 30 } },
    { field: "buffer_min", type: "integer", meta: { interface: "input", note: "Minutos de limpieza/preparación entre citas" }, schema: { default_value: 0 } },
    { field: "activo", type: "boolean", schema: { default_value: true }, meta: { interface: "boolean" } },
    // Sin default: vacío = ese servicio no genera recall (pantalla Mensajes del panel).
    { field: "recall_meses", type: "integer", meta: { interface: "input", note: "Cada cuántos meses conviene repetir este servicio (ej. 6 para limpieza dental). Vacío = no genera recordatorio de seguimiento." }, schema: {} },
  ]);
  await ensureM2O("services", "specialty", "specialties", "RESTRICT");

  await ensureCollection("working_hours", "schedule", "Horario laboral por odontólogo y día");
  await ensureM2O("working_hours", "doctor", "doctors", "CASCADE");
  await ensureFields("working_hours", [
    { field: "dia_semana", type: "integer", meta: { interface: "select-dropdown", note: "1=Lun ... 7=Dom", options: { choices: [1,2,3,4,5,6,7].map((n) => ({ text: String(n), value: n })) } }, schema: {} },
    { field: "hora_inicio", type: "time", meta: { interface: "datetime" }, schema: {} },
    { field: "hora_fin", type: "time", meta: { interface: "datetime" }, schema: {} },
  ]);

  await ensureCollection("time_off", "event_busy", "Ausencias: festivos, vacaciones, permisos");
  await ensureM2O("time_off", "doctor", "doctors", "CASCADE");
  await ensureFields("time_off", [
    { field: "inicio", type: "timestamp", meta: { interface: "datetime" }, schema: {} },
    { field: "fin", type: "timestamp", meta: { interface: "datetime" }, schema: {} },
    { field: "motivo", type: "string", meta: { interface: "input" }, schema: {} },
  ]);

  await ensureCollection("patients", "personal_injury", "Pacientes (identificados por WhatsApp)");
  await ensureFields("patients", [
    { field: "telefono", type: "string", meta: { interface: "input", note: "E.164 (varios pacientes pueden compartir un número)" }, schema: {} },
    { field: "nombre", type: "string", meta: { interface: "input" }, schema: {} },
    {
      field: "titular",
      type: "boolean",
      meta: { interface: "boolean", note: "Dueño del número; el bot conversa como el titular. Los familiares bajo el mismo teléfono van en false." },
      schema: { default_value: true },
    },
    { field: "notas", type: "text", meta: { interface: "input-multiline" }, schema: {} },
  ]);

  await ensureCollection("appointments", "event", "Citas agendadas");
  await ensureM2O("appointments", "doctor", "doctors", "RESTRICT");
  await ensureM2O("appointments", "patient", "patients", "CASCADE");
  await ensureM2O("appointments", "service", "services", "RESTRICT");
  await ensureFields("appointments", [
    { field: "inicio", type: "timestamp", meta: { interface: "datetime" }, schema: {} },
    { field: "fin", type: "timestamp", meta: { interface: "datetime" }, schema: {} },
    {
      field: "estado",
      type: "string",
      meta: {
        interface: "select-dropdown",
        options: { choices: ["pendiente", "confirmada", "cancelada", "completada", "no_show"].map((v) => ({ text: v, value: v })) },
      },
      schema: { default_value: "pendiente" },
    },
    { field: "origen", type: "string", meta: { interface: "input", note: "whatsapp | panel | ..." }, schema: { default_value: "whatsapp" } },
    { field: "recordatorio_24h_enviado", type: "boolean", meta: { interface: "boolean", note: "Recordatorio de 24h antes ya enviado" }, schema: { default_value: false } },
    { field: "recordatorio_2h_enviado", type: "boolean", meta: { interface: "boolean", note: "Recordatorio de 2h antes ya enviado" }, schema: { default_value: false } },
    // Los tres siguientes los marca a mano la recepción desde la pantalla Mensajes del
    // panel (envío manual mientras la WABA está bloqueada); el bot no los toca.
    { field: "confirmacion_manual_enviada", type: "boolean", meta: { interface: "boolean", note: "Recepción ya envió a mano el mensaje de confirmación de esta cita" }, schema: { default_value: false } },
    { field: "recall_mensaje_enviado", type: "boolean", meta: { interface: "boolean", note: "Recepción ya envió a mano el recordatorio de seguimiento derivado de esta cita completada" }, schema: { default_value: false } },
    { field: "cancelacion_mensaje_enviado", type: "boolean", meta: { interface: "boolean", note: "Recepción ya avisó a mano al paciente de que esta cita fue cancelada" }, schema: { default_value: false } },
    // Lo marcan el panel y el hook `time-off-cascade-hook` al cancelar en cascada por
    // una ausencia del médico: distingue esas citas de las que la recepción canceló
    // de común acuerdo con el paciente (esas no necesitan aviso).
    { field: "cancelada_por_ausencia", type: "boolean", meta: { interface: "boolean", note: "La cita se canceló automáticamente por una ausencia del médico" }, schema: { default_value: false } },
  ]);

  await ensureCollection("messages", "chat", "Historial de mensajes de WhatsApp");
  await ensureM2O("messages", "patient", "patients", "CASCADE");
  await ensureFields("messages", [
    { field: "direccion", type: "string", meta: { interface: "select-dropdown", options: { choices: [{ text: "in", value: "in" }, { text: "out", value: "out" }] } }, schema: {} },
    { field: "contenido", type: "text", meta: { interface: "input-multiline" }, schema: {} },
    { field: "wa_message_id", type: "string", meta: { interface: "input" }, schema: {} },
    {
      field: "date_created",
      type: "timestamp",
      meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true },
      schema: {},
    },
  ]);

  await ensureCollection("waitlist", "hourglass_empty", "Lista de espera: pacientes esperando una cancelación");
  await ensureM2O("waitlist", "patient", "patients", "CASCADE");
  await ensureM2O("waitlist", "service", "services", "RESTRICT");
  await ensureM2O("waitlist", "doctor", "doctors", "RESTRICT");
  await ensureM2O("waitlist", "oferta_doctor", "doctors", "SET NULL");
  await ensureM2O("waitlist", "appointment_generada", "appointments", "SET NULL");
  await ensureFields("waitlist", [
    {
      field: "dia_semana",
      type: "integer",
      meta: { interface: "select-dropdown", note: "1=Lun ... 7=Dom. Vacío = cualquier día", options: { choices: [1,2,3,4,5,6,7].map((n) => ({ text: String(n), value: n })) } },
      schema: {},
    },
    { field: "hora_desde", type: "time", meta: { interface: "datetime", note: "Vacío = sin límite inferior" }, schema: {} },
    { field: "hora_hasta", type: "time", meta: { interface: "datetime", note: "Vacío = sin límite superior" }, schema: {} },
    {
      field: "estado",
      type: "string",
      meta: {
        interface: "select-dropdown",
        options: { choices: ["activa", "ofrecida", "agendada", "cancelada"].map((v) => ({ text: v, value: v })) },
      },
      schema: { default_value: "activa" },
    },
    { field: "oferta_inicio", type: "timestamp", meta: { interface: "datetime", note: "Hueco actualmente ofrecido (estado=ofrecida)" }, schema: {} },
    { field: "oferta_expira", type: "timestamp", meta: { interface: "datetime", note: "Cuándo expira la oferta actual" }, schema: {} },
    { field: "notas", type: "text", meta: { interface: "input-multiline" }, schema: {} },
    {
      field: "date_created",
      type: "timestamp",
      meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true },
      schema: {},
    },
  ]);

  console.log("\nListo. Revisa las colecciones en el panel de Directus.");
  console.log("Siguiente: crear el rol de servicio y los roles Odontólogo/Recepción con permisos.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
