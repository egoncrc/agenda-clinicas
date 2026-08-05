/**
 * Crea una SEGUNDA clínica de prueba completa ("Clínica Norte") con
 * doctores, servicios, horarios, pacientes, citas y cuentas de Directus
 * (doctores + recepcionistas) para probar de punta a punta el aislamiento
 * multi-clínica. Pensado para correrse una sola vez; no es idempotente como
 * los otros scripts de provisioning (crea todo con nombres "Prueba/Norte"
 * fáciles de identificar y borrar después si hace falta).
 *
 * Uso:
 *   DIRECTUS_ADMIN_TOKEN=<token_admin> npx tsx scripts/seed-test-clinic.ts
 */
import "dotenv/config";
import {
  createDirectus,
  rest,
  staticToken,
  createItem,
  createItems,
  createUser,
  readRoles,
  updateItem,
} from "@directus/sdk";
import type { Schema } from "../src/directus.js";
import type { IsoWeekday } from "../src/domain/types.js";

const url = process.env.DIRECTUS_URL;
const adminToken = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !adminToken) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN).");
  process.exit(1);
}

const client = createDirectus<Schema>(url).with(staticToken(adminToken)).with(rest());

const TEST_PASSWORD = "PruebaClinica2026!";
const TEST_WHATSAPP_NUMBER = "+10000000099"; // número ficticio, solo para simular el webhook del bot

async function main() {
  console.log(`Sembrando clínica de prueba en ${url} ...\n`);

  // ---- Clínica ----
  const clinic = (await client.request(
    createItem("clinics", {
      nombre: "Clínica Norte (prueba)",
      activo: true,
      whatsapp_numero: TEST_WHATSAPP_NUMBER,
    } as never),
  )) as { id: string };
  console.log(`✓ Clínica creada: Clínica Norte (prueba) — ${clinic.id}`);

  // ---- Especialidad (clinic-scoped: cada clínica tiene la suya) ----
  const specialty = (await client.request(
    createItem("specialties", { nombre: "Odontología (prueba)", activo: true, clinic: clinic.id } as never),
  )) as { id: string };

  // ---- Doctoras ----
  // La identidad va en `doctors`; el vínculo con la clínica (con su especialidad
  // en esa sede) en `clinics_doctors`. Ver seed-test-clinic-users.ts para el
  // caso de un médico vinculado a dos clínicas.
  const doctor1 = (await client.request(
    createItem("doctors", { nombre: "Dr. Prueba Norte Uno", activo: true } as never),
  )) as { id: string };
  const doctor2 = (await client.request(
    createItem("doctors", { nombre: "Dra. Prueba Norte Dos", activo: true } as never),
  )) as { id: string };
  for (const doctorId of [doctor1.id, doctor2.id]) {
    await client.request(
      createItem("clinics_doctors", {
        clinics_id: clinic.id,
        doctors_id: doctorId,
        specialty: specialty.id,
        activo: true,
      } as never),
    );
  }
  console.log(`✓ Doctoras: ${doctor1.id}, ${doctor2.id}`);

  // ---- Servicios ----
  const SERVICES = [
    { nombre: "Consulta general (prueba)", duracion_min: 20, buffer_min: 5 },
    { nombre: "Limpieza dental (prueba)", duracion_min: 30, buffer_min: 10 },
    { nombre: "Ortodoncia - control (prueba)", duracion_min: 45, buffer_min: 10 },
  ];
  const serviceIds: string[] = [];
  for (const s of SERVICES) {
    const row = (await client.request(
      createItem("services", { ...s, activo: true, clinic: clinic.id, specialty: specialty.id } as never),
    )) as { id: string };
    serviceIds.push(row.id);
  }
  console.log(`✓ Servicios: ${serviceIds.join(", ")}`);

  // ---- Horario laboral (lunes a viernes 08:00-16:00 para ambos) ----
  const LUNES_A_VIERNES: IsoWeekday[] = [1, 2, 3, 4, 5];
  for (const doctorId of [doctor1.id, doctor2.id]) {
    await client.request(
      createItems(
        "working_hours",
        LUNES_A_VIERNES.map((dia_semana) => ({
          doctor: doctorId,
          clinic: clinic.id,
          dia_semana,
          hora_inicio: "08:00:00",
          hora_fin: "16:00:00",
        })),
      ),
    );
  }
  console.log("✓ Horarios laborales cargados (Lun-Vie 08:00-16:00)");

  // ---- Pacientes ----
  const PATIENTS = [
    { nombre: "Paciente Prueba Uno", telefono: "+19999900001" },
    { nombre: "Paciente Prueba Dos", telefono: "+19999900002" },
    { nombre: "Paciente Prueba Tres", telefono: "+19999900003" },
    { nombre: "Paciente Prueba Cuatro", telefono: "+19999900004" },
  ];
  const patientIds: string[] = [];
  for (const p of PATIENTS) {
    const row = (await client.request(
      createItem("patients", { ...p, titular: true, clinic: clinic.id } as never),
    )) as { id: string };
    patientIds.push(row.id);
  }
  console.log(`✓ Pacientes: ${patientIds.join(", ")}`);

  // ---- Citas (próximo lunes en adelante, dentro del horario 08:00-16:00) ----
  function nextWeekdayAt(hour: number, daysAhead: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }
  const APPOINTMENTS = [
    { doctor: doctor1.id, patient: patientIds[0]!, service: serviceIds[0]!, inicioHour: 9, daysAhead: 3, estado: "confirmada" },
    { doctor: doctor1.id, patient: patientIds[1]!, service: serviceIds[1]!, inicioHour: 11, daysAhead: 3, estado: "pendiente" },
    { doctor: doctor2.id, patient: patientIds[2]!, service: serviceIds[2]!, inicioHour: 10, daysAhead: 4, estado: "confirmada" },
    { doctor: doctor2.id, patient: patientIds[3]!, service: serviceIds[0]!, inicioHour: 14, daysAhead: 5, estado: "pendiente" },
  ] as const;
  for (const a of APPOINTMENTS) {
    const inicio = nextWeekdayAt(a.inicioHour, a.daysAhead);
    const fin = new Date(new Date(inicio).getTime() + 30 * 60_000).toISOString();
    await client.request(
      createItem("appointments", {
        clinic: clinic.id,
        doctor: a.doctor,
        patient: a.patient,
        service: a.service,
        inicio,
        fin,
        estado: a.estado,
        origen: "seed_prueba",
      } as never),
    );
  }
  console.log(`✓ ${APPOINTMENTS.length} citas de prueba creadas`);

  // ---- Roles (para asignar a las cuentas nuevas) ----
  const roles = (await client.request(
    readRoles({ filter: { name: { _in: ["Doctor", "Receptionist"] } } as never, fields: ["id", "name"] } as never),
  )) as { id: string; name: string }[];
  const doctorRoleId = roles.find((r) => r.name === "Doctor")?.id;
  const receptionistRoleId = roles.find((r) => r.name === "Receptionist")?.id;
  if (!doctorRoleId || !receptionistRoleId) {
    throw new Error("No se encontraron los roles Doctor/Receptionist.");
  }

  // ---- Usuarios de prueba: doctores ----
  const doctorUser1 = (await client.request(
    createUser({
      email: "doctora.prueba1@testclinica.local",
      password: TEST_PASSWORD,
      first_name: "Doctora",
      last_name: "Prueba Uno",
      role: doctorRoleId,
      status: "active",
    } as never),
  )) as { id: string };
  await client.request(updateItem("doctors", doctor1.id, { usuario: doctorUser1.id } as never));

  const doctorUser2 = (await client.request(
    createUser({
      email: "doctora.prueba2@testclinica.local",
      password: TEST_PASSWORD,
      first_name: "Doctora",
      last_name: "Prueba Dos",
      role: doctorRoleId,
      status: "active",
    } as never),
  )) as { id: string };
  await client.request(updateItem("doctors", doctor2.id, { usuario: doctorUser2.id } as never));
  console.log(`✓ Cuentas de doctores de prueba creadas y vinculadas`);

  // ---- Usuarios de prueba: recepcionistas ----
  const principalClinicId = process.env.PRINCIPAL_CLINIC_ID;
  if (!principalClinicId) {
    throw new Error("Falta PRINCIPAL_CLINIC_ID en el entorno (id de 'Clínica Principal').");
  }

  const receptionMulti = (await client.request(
    createUser({
      email: "recepcion.prueba.multi@testclinica.local",
      password: TEST_PASSWORD,
      first_name: "Recepción",
      last_name: "Prueba (multi-clínica)",
      role: receptionistRoleId,
      status: "active",
    } as never),
  )) as { id: string };
  await client.request(
    createItem("clinics_directus_users" as never, { clinics_id: clinic.id, directus_users_id: receptionMulti.id } as never),
  );
  await client.request(
    createItem("clinics_directus_users" as never, { clinics_id: principalClinicId, directus_users_id: receptionMulti.id } as never),
  );

  const receptionSingle = (await client.request(
    createUser({
      email: "recepcion.prueba.norte@testclinica.local",
      password: TEST_PASSWORD,
      first_name: "Recepción",
      last_name: "Prueba (solo Norte)",
      role: receptionistRoleId,
      status: "active",
    } as never),
  )) as { id: string };
  await client.request(
    createItem("clinics_directus_users" as never, { clinics_id: clinic.id, directus_users_id: receptionSingle.id } as never),
  );
  console.log(`✓ Cuentas de recepcionistas de prueba creadas y vinculadas`);

  console.log("\n=== Resumen ===");
  console.log(`Clínica Norte (prueba): ${clinic.id}`);
  console.log(`Número WhatsApp de prueba (para simular webhook): ${TEST_WHATSAPP_NUMBER}`);
  console.log(`Contraseña de todas las cuentas de prueba: ${TEST_PASSWORD}`);
  console.log("  - doctora.prueba1@testclinica.local (Dr. Prueba Norte Uno, solo Clínica Norte)");
  console.log("  - doctora.prueba2@testclinica.local (Dra. Prueba Norte Dos, solo Clínica Norte)");
  console.log("  - recepcion.prueba.multi@testclinica.local (vinculada a Clínica Principal + Clínica Norte)");
  console.log("  - recepcion.prueba.norte@testclinica.local (vinculada solo a Clínica Norte)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
