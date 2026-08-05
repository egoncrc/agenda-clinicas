/**
 * Aplica el aislamiento por clínica a las policies `Receptionist`/`Doctor`
 * existentes en Directus (ver plan multi-clínica). Idempotente: por cada
 * (policy, colección, acción) objetivo, actualiza la fila de permiso si ya
 * existe o la crea si falta — mismo patrón ya usado manualmente en este
 * proyecto para los fixes de permisos documentados en CLAUDE.md.
 *
 * Requiere que `scripts/provision-clinics.ts` y `scripts/provision-doctor-clinics.ts`
 * ya se hayan corrido (colección `clinics`, campo `clinic`, tabla puente
 * `clinics_doctors` y alias `recepcionistas`/`medicos`/`clinicas` existentes).
 *
 * Uso:
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token_admin> npx tsx scripts/provision-clinic-permissions.ts
 *
 * IMPORTANTE (ver CLAUDE.md, "Bug pattern..."): toda fila de permiso creada/
 * actualizada aquí lleva `fields: ["*"]` explícito, nunca `null` — un filtro
 * bien configurado con `fields: null` igual devuelve 403 en consultas
 * filtradas/agregadas.
 *
 * ÚNICA EXCEPCIÓN: `Receptionist · patients.update` lleva lista explícita de
 * campos (PATIENT_EDITABLE_FIELDS) para dejar fuera `activo`, que es la baja
 * lógica del paciente y solo el administrador puede tocar. Esa invariante de
 * `fields: ["*"]` existe por el bug de las consultas filtradas/agregadas, que
 * es un problema de LECTURA; en `update` la whitelist de campos es el
 * mecanismo previsto por Directus y es lo que hace que "solo el admin da de
 * baja" sea real y no solo UI. OJO: todo campo nuevo de `patients` hay que
 * agregarlo a esa lista o recepción no podrá editarlo.
 *
 * SEGUNDA CONSECUENCIA DE `fields: ["*"]` EN `appointments.update`: el hook
 * `appointment-cancel-stamp-hook` es un `filter`, y un filter corre ANTES de
 * validar el payload contra los permisos de campo de quien escribe. Al inyectar
 * `cancelado_en`/`cancelado_por` en el payload, esos campos deben estar dentro
 * del `fields` de la fila `appointments.update` de la policy o el usuario
 * recibiría un 403 al cancelar una cita. Hoy se cumple solo; si alguna vez se
 * cambia esa fila a una lista explícita, hay que incluir los tres campos de
 * cancelación.
 *
 * LIMITACIÓN CONOCIDA (ver CLAUDE.md y clinica/README.md): el campo
 * `validation` de un permiso `create` se evalúa contra el payload recién
 * enviado, no contra la fila ya existente, así que no puede resolver una
 * relación como "la clínica de este doctor debe ser una de las mías". Por
 * eso este script SOLO acota `read`/`update`/`delete` — el `create` de estas
 * colecciones para `Receptionist` queda sin ese filtro (igual que el gap ya
 * aceptado y documentado para `working_hours`), mitigado por la UI del panel
 * (que solo ofrece la clínica activa como opción) y por el filtro `clinic`
 * que sí puede aplicarse en el payload de creación desde el propio código.
 */
import "dotenv/config";
import {
  createDirectus,
  rest,
  staticToken,
  readPolicies,
  readPermissions,
  createPermission,
  updatePermission,
  deletePermission,
} from "@directus/sdk";

const url = process.env.DIRECTUS_URL;
const token = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !token) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN).");
  process.exit(1);
}

const client = createDirectus(url).with(staticToken(token)).with(rest());

async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}`, JSON.stringify((err as { errors?: unknown })?.errors ?? err));
  }
}

/** Busca el id de una policy por nombre exacto. */
async function findPolicyId(name: string): Promise<string | undefined> {
  const rows = (await client.request(
    readPolicies({ filter: { name: { _eq: name } } as never, limit: 1, fields: ["id", "name"] } as never),
  )) as { id: string; name: string }[];
  return rows[0]?.id;
}

/**
 * Asegura una fila de permiso (policy, colección, acción) con el filtro dado — actualiza si existe, crea si no.
 * `fields` solo se pasa distinto de `["*"]` para acotar qué columnas puede escribir
 * un rol (ver la EXCEPCIÓN del encabezado); nunca para lecturas.
 */
async function ensurePermission(
  policyId: string,
  policyLabel: string,
  collection: string,
  action: "create" | "read" | "update" | "delete",
  filter: Record<string, unknown>,
  fields: string[] = ["*"],
): Promise<void> {
  const label = `${policyLabel} · ${collection}.${action}`;
  const existing = (await client.request(
    readPermissions({
      filter: { policy: { _eq: policyId }, collection: { _eq: collection }, action: { _eq: action } } as never,
      limit: 1,
    } as never),
  )) as { id: number }[];

  if (existing[0]) {
    await safe(`actualizar permiso ${label}`, () =>
      client.request(updatePermission(existing[0]!.id, { fields, permissions: filter } as never)),
    );
  } else {
    await safe(`crear permiso ${label}`, () =>
      client.request(
        createPermission({
          policy: policyId,
          collection,
          action,
          fields,
          permissions: filter,
        } as never),
      ),
    );
  }
}

/** Quita una fila de permiso si existe (para revocar una acción que antes se concedía). */
async function removePermission(
  policyId: string,
  policyLabel: string,
  collection: string,
  action: "create" | "read" | "update" | "delete",
): Promise<void> {
  const label = `${policyLabel} · ${collection}.${action}`;
  const existing = (await client.request(
    readPermissions({
      filter: { policy: { _eq: policyId }, collection: { _eq: collection }, action: { _eq: action } } as never,
      limit: 1,
    } as never),
  )) as { id: number }[];

  if (!existing[0]) {
    console.log(`  · revocar permiso ${label} (no existía)`);
    return;
  }
  await safe(`revocar permiso ${label}`, () => client.request(deletePermission(existing[0]!.id)));
}

const ACTIONS: ("read" | "update" | "delete")[] = ["read", "update", "delete"];

/** Ceiling de acceso de una recepcionista: solo clínicas donde figura en el M2M `recepcionistas`. */
const RECEPTIONIST_CLINIC_CONDITION = {
  recepcionistas: { directus_users_id: { _eq: "$CURRENT_USER" }, activo: { _eq: true } },
};

/**
 * Ceiling de acceso de un médico: solo clínicas donde figura en el M2M
 * `medicos` (tabla puente `clinics_doctors`) con el vínculo activo. Reemplaza
 * al viejo `{doctores: {usuario: ...}}`, que dependía del M2O `doctors.clinic`
 * y por tanto solo podía devolver UNA clínica.
 */
const DOCTOR_CLINIC_CONDITION = {
  medicos: { doctors_id: { usuario: { _eq: "$CURRENT_USER" } }, activo: { _eq: true } },
};

/** Un médico es siempre "el de esta cuenta": `doctors.usuario` no depende de la clínica. */
const OWN_DOCTOR_CONDITION = { doctor: { usuario: { _eq: "$CURRENT_USER" } } };

/**
 * Campos de `patients` que recepción puede escribir desde la pantalla de
 * mantenimiento. Deja fuera `activo` (baja lógica, solo administrador) y los
 * campos de sistema. Todo campo nuevo de la colección va acá o recepción no
 * podrá editarlo.
 */
const PATIENT_EDITABLE_FIELDS = [
  "nombre",
  "telefono",
  "titular",
  "identificacion",
  "correo",
  "provincia",
  "canton",
  "distrito",
  "direccion",
  "notas",
];

async function main() {
  console.log(`Aplicando permisos multi-clínica en ${url} ...`);

  const receptionistId = await findPolicyId("Receptionist");
  const doctorId = await findPolicyId("Doctor");

  if (!receptionistId) console.error("  ✗ No se encontró la policy 'Receptionist' — revisa el nombre exacto en Directus.");
  if (!doctorId) console.error("  ✗ No se encontró la policy 'Doctor' — revisa el nombre exacto en Directus.");

  if (receptionistId) {
    console.log("\nPolicy Receptionist:");

    // Colecciones con campo `clinic` directo.
    const DIRECT = ["specialties", "services", "appointments", "waitlist"];
    for (const collection of DIRECT) {
      const filter = { clinic: RECEPTIONIST_CLINIC_CONDITION };
      for (const action of ACTIONS) {
        await ensurePermission(receptionistId, "Receptionist", collection, action, filter);
      }
    }

    // `doctors` ya no tiene campo `clinic`: un médico puede trabajar en varias
    // clínicas, así que se llega a él por la tabla puente. El filtro NO exige
    // `activo` en el vínculo a propósito: recepción debe seguir viendo al médico
    // dado de baja (historial, reactivación).
    {
      const filter = { clinicas: { clinics_id: RECEPTIONIST_CLINIC_CONDITION } };
      for (const action of ACTIONS) {
        await ensurePermission(receptionistId, "Receptionist", "doctors", action, filter);
      }
    }

    // La tabla puente en sí: recepción la lee (catálogo de médicos de su clínica)
    // y la edita (especialidad, alta/baja en esta sede). `create` no se concede:
    // dar de alta o vincular un médico es del wizard de administración.
    {
      const filter = { clinics_id: RECEPTIONIST_CLINIC_CONDITION };
      for (const action of ACTIONS) {
        await ensurePermission(receptionistId, "Receptionist", "clinics_doctors", action, filter);
      }
    }

    // `patients` va aparte del resto de las DIRECT por la baja lógica: se lee
    // completa, se escribe sin `activo`, y no se borra nunca (borrar arrastra
    // citas/mensajes/lista de espera por ON DELETE CASCADE — para eso está la
    // baja lógica, reservada al administrador).
    {
      const filter = { clinic: RECEPTIONIST_CLINIC_CONDITION };
      await ensurePermission(receptionistId, "Receptionist", "patients", "read", filter);
      await ensurePermission(receptionistId, "Receptionist", "patients", "update", filter, PATIENT_EDITABLE_FIELDS);
      await removePermission(receptionistId, "Receptionist", "patients", "delete");
    }

    // `working_hours`/`time_off` ahora tienen campo `clinic` propio (antes se
    // derivaban de `doctor.clinic`, que con un médico multi-clínica ya no
    // identifica nada): horario y ausencias son por sede.
    for (const collection of ["working_hours", "time_off"]) {
      const filter = { clinic: RECEPTIONIST_CLINIC_CONDITION };
      for (const action of ACTIONS) {
        await ensurePermission(receptionistId, "Receptionist", collection, action, filter);
      }
    }

    // Derivada vía relación `patient`.
    {
      const filter = { patient: { clinic: RECEPTIONIST_CLINIC_CONDITION } };
      for (const action of ACTIONS) {
        await ensurePermission(receptionistId, "Receptionist", "messages", action, filter);
      }
      // `create` va SIN filtro de fila a propósito, por la LIMITACIÓN CONOCIDA del
      // encabezado de este archivo: en `create` Directus no evalúa `permissions`
      // (la fila todavía no existe) sino `validation`, que no puede resolver la
      // relación `patient.clinic`. Misma decisión ya aceptada para `working_hours`.
      // Lo necesita la pantalla Mensajes del panel, que registra en `messages` cada
      // mensaje que la recepción envía a mano. El hueco no expone datos: `read`
      // sigue acotado, así que ni siquiera podría releer lo que escribiera.
      await ensurePermission(receptionistId, "Receptionist", "messages", "create", {});
    }

    // Lectura de `clinics`: solo las propias (para el selector de clínica del panel).
    await ensurePermission(receptionistId, "Receptionist", "clinics", "read", RECEPTIONIST_CLINIC_CONDITION);
  }

  if (doctorId) {
    console.log("\nPolicy Doctor:");
    // Lectura de `clinics`: TODAS en las que trabaja (vía la tabla puente). Es
    // lo que hace aparecer el selector de clínica del panel para un médico que
    // atiende en más de una sede.
    await ensurePermission(doctorId, "Doctor", "clinics", "read", DOCTOR_CLINIC_CONDITION);
    // Lectura de `specialties`: las de las clínicas donde trabaja (selector del panel).
    await ensurePermission(doctorId, "Doctor", "specialties", "read", {
      clinic: DOCTOR_CLINIC_CONDITION,
    });
    // Sus propios vínculos: el catálogo del panel resuelve por acá qué
    // especialidad tiene en la clínica activa.
    await ensurePermission(doctorId, "Doctor", "clinics_doctors", "read", {
      doctors_id: { usuario: { _eq: "$CURRENT_USER" } },
    });

    // Las filas siguientes NO son nuevas: existían solo en la base, creadas a
    // mano (documentadas en CLAUDE.md con la nomenclatura vieja `dentists`). Se
    // fijan acá para que el permiso quede versionado y una instalación nueva no
    // dependa de que alguien las recuerde. Sus filtros no cambian con el
    // multi-clínica: `doctors.usuario` no depende de la sede.
    await ensurePermission(doctorId, "Doctor", "doctors", "read", { usuario: { _eq: "$CURRENT_USER" } });
    await ensurePermission(doctorId, "Doctor", "appointments", "read", OWN_DOCTOR_CONDITION);
    await ensurePermission(doctorId, "Doctor", "appointments", "update", OWN_DOCTOR_CONDITION);

    // Las dos siguientes también existían solo en la base. Se versionan ahora
    // porque la sección de Reportes depende de ellas y su ausencia se manifiesta
    // como un 403 opaco en medio de un reporte, no como una pantalla que
    // claramente no cargó:
    //   - `services`: los reportes de servicios y de especialidades resuelven el
    //     nombre y la especialidad del servicio de cada cita.
    //   - `patients`: el reporte de residencia lee provincia/cantón/distrito. El
    //     filtro dota al médico de los pacientes con los que TIENE cita, vía el
    //     alias O2M `patients.appointments` (creado a mano justo para permitir
    //     este dot-path; ver CLAUDE.md). Sin create/update/delete: el panel nunca
    //     necesita que un médico edite una ficha.
    await ensurePermission(doctorId, "Doctor", "services", "read", { clinic: DOCTOR_CLINIC_CONDITION });
    await ensurePermission(doctorId, "Doctor", "patients", "read", {
      appointments: { doctor: { usuario: { _eq: "$CURRENT_USER" } } },
    });
    for (const collection of ["working_hours", "time_off"]) {
      for (const action of ACTIONS) {
        await ensurePermission(doctorId, "Doctor", collection, action, OWN_DOCTOR_CONDITION);
      }
      // `create` sin filtro de fila por la LIMITACIÓN CONOCIDA del encabezado
      // (en `create` Directus evalúa `validation`, que no resuelve relaciones).
      await ensurePermission(doctorId, "Doctor", collection, "create", {});
    }
  }

  // La cuenta de servicio del bot lee especialidades (list_specialties). Acota
  // por clínica en el código, así que aquí basta lectura sin filtro de fila.
  const botId = await findPolicyId("Bot WhatsApp");
  if (botId) {
    console.log("\nPolicy Bot WhatsApp:");
    await ensurePermission(botId, "Bot WhatsApp", "specialties", "read", {});
    // SIN ESTO EL BOT SE QUEDA SIN MÉDICOS: desde el multi-clínica, la lista de
    // médicos de una clínica sale de la tabla puente (src/repositories/doctors.ts),
    // así que sin lectura acá no puede ofrecer horarios ni agendar nada.
    await ensurePermission(botId, "Bot WhatsApp", "clinics_doctors", "read", {});
  } else {
    console.error("  ✗ No se encontró la policy 'Bot WhatsApp' — concede lectura de `specialties` y `clinics_doctors` manualmente.");
  }

  console.log("\nListo. Verifica en Directus con cuentas de prueba (recepcionista con 2 clínicas, médico con 2 clínicas y médico con 1) antes de dar esto por bueno en producción.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
