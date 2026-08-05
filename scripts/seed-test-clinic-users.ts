/**
 * Segunda mitad del seed de prueba multi-clínica: crea una tercera clínica
 * mínima ("Clínica Sur (prueba)") solo para poder probar el caso de una
 * recepcionista vinculada a 2 clínicas SIN tocar la clínica real (Clínica
 * Principal, con pacientes reales) — decisión tomada con el usuario. Luego
 * crea las cuentas de Directus de prueba y las vincula.
 *
 * Siembra además el caso estrella del médico multi-clínica: la doctora de
 * Clínica Norte queda vinculada TAMBIÉN a Clínica Sur, con otra especialidad y
 * otros días de atención. Al ingresar con su correo le aparece el selector de
 * clínica, y una cita suya a las 10:00 en Norte debe impedir otra a las 10:00
 * en Sur (misma identidad `doctors`, que es el punto del diseño M2M).
 */
import "dotenv/config";
import { createDirectus, rest, staticToken, createItem, createItems, createUser, readRoles, updateItem } from "@directus/sdk";
import type { IsoWeekday } from "../src/domain/types.js";
import type { Schema } from "../src/directus.js";

const url = process.env.DIRECTUS_URL;
const adminToken = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !adminToken) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN.");
  process.exit(1);
}
const client = createDirectus<Schema>(url).with(staticToken(adminToken)).with(rest());

const TEST_PASSWORD = "PruebaClinica2026!";
const EMAIL_DOMAIN = "example.com"; // dominio reservado para pruebas (RFC 2606), no entrega correo real

async function main() {
  const norteClinicId = process.env.NORTE_CLINIC_ID!;
  const doctor1Id = process.env.DOCTOR1_ID!;
  const doctor2Id = process.env.DOCTOR2_ID!;
  if (!norteClinicId || !doctor1Id || !doctor2Id) {
    throw new Error("Faltan NORTE_CLINIC_ID / DOCTOR1_ID / DOCTOR2_ID en el entorno.");
  }

  // ---- Clínica Sur (prueba): solo para el caso multi-clínica, no toca Clínica Principal ----
  const sur = (await client.request(
    createItem("clinics", { nombre: "Clínica Sur (prueba)", activo: true } as never),
  )) as { id: string };
  const surSpecialty = (await client.request(
    createItem("specialties", { nombre: "Ortodoncia (prueba Sur)", activo: true, clinic: sur.id } as never),
  )) as { id: string };
  const surDoctor = (await client.request(
    createItem("doctors", { nombre: "Dr. Prueba Sur Uno", activo: true } as never),
  )) as { id: string };
  await client.request(
    createItem("clinics_doctors", {
      clinics_id: sur.id,
      doctors_id: surDoctor.id,
      specialty: surSpecialty.id,
      activo: true,
    } as never),
  );

  // El caso estrella: la doctora 1 de Norte también atiende en Sur, con otra
  // especialidad. Una sola fila `doctors`, dos vínculos.
  await client.request(
    createItem("clinics_doctors", {
      clinics_id: sur.id,
      doctors_id: doctor1Id,
      specialty: surSpecialty.id,
      activo: true,
    } as never),
  );
  // Y con otros días: en Norte atiende Lun-Vie (seed-test-clinic.ts), en Sur solo sábado.
  const SABADO: IsoWeekday[] = [6];
  await client.request(
    createItems(
      "working_hours",
      SABADO.map((dia_semana) => ({
        doctor: doctor1Id,
        clinic: sur.id,
        dia_semana,
        hora_inicio: "09:00:00",
        hora_fin: "13:00:00",
      })),
    ),
  );
  console.log(`✓ Dr./Dra. de Norte (${doctor1Id}) vinculada también a Clínica Sur (sábados 09:00-13:00)`);

  const surService = (await client.request(
    createItem("services", {
      nombre: "Consulta general (prueba Sur)",
      duracion_min: 25,
      buffer_min: 5,
      activo: true,
      clinic: sur.id,
      specialty: surSpecialty.id,
    } as never),
  )) as { id: string };
  const surPatient = (await client.request(
    createItem("patients", {
      nombre: "Paciente Prueba Sur Uno",
      telefono: "+19999900010",
      titular: true,
      clinic: sur.id,
    } as never),
  )) as { id: string };
  console.log(`✓ Clínica Sur (prueba) creada: ${sur.id} (doctora ${surDoctor.id}, servicio ${surService.id}, paciente ${surPatient.id})`);

  const roles = (await client.request(
    readRoles({ filter: { name: { _in: ["Doctor", "Receptionist"] } } as never, fields: ["id", "name"] } as never),
  )) as { id: string; name: string }[];
  const doctorRoleId = roles.find((r) => r.name === "Doctor")?.id;
  const receptionistRoleId = roles.find((r) => r.name === "Receptionist")?.id;
  if (!doctorRoleId || !receptionistRoleId) throw new Error("No se encontraron los roles.");

  const doctorUser1 = (await client.request(
    createUser({
      email: `doctora.prueba1@${EMAIL_DOMAIN}`,
      password: TEST_PASSWORD,
      first_name: "Doctora",
      last_name: "Prueba Uno",
      role: doctorRoleId,
      status: "active",
    } as never),
  )) as { id: string };
  await client.request(updateItem("doctors", doctor1Id, { usuario: doctorUser1.id } as never));

  const doctorUser2 = (await client.request(
    createUser({
      email: `doctora.prueba2@${EMAIL_DOMAIN}`,
      password: TEST_PASSWORD,
      first_name: "Doctora",
      last_name: "Prueba Dos",
      role: doctorRoleId,
      status: "active",
    } as never),
  )) as { id: string };
  await client.request(updateItem("doctors", doctor2Id, { usuario: doctorUser2.id } as never));
  console.log("✓ Cuentas de doctores de prueba creadas y vinculadas");

  // Recepcionista multi-clínica: Norte + Sur (ambas de prueba, ninguna toca datos reales).
  const receptionMulti = (await client.request(
    createUser({
      email: `recepcion.prueba.multi@${EMAIL_DOMAIN}`,
      password: TEST_PASSWORD,
      first_name: "Recepción",
      last_name: "Prueba (multi-clínica)",
      role: receptionistRoleId,
      status: "active",
    } as never),
  )) as { id: string };
  await client.request(
    createItem("clinics_directus_users" as never, { clinics_id: norteClinicId, directus_users_id: receptionMulti.id } as never),
  );
  await client.request(
    createItem("clinics_directus_users" as never, { clinics_id: sur.id, directus_users_id: receptionMulti.id } as never),
  );

  const receptionSingle = (await client.request(
    createUser({
      email: `recepcion.prueba.norte@${EMAIL_DOMAIN}`,
      password: TEST_PASSWORD,
      first_name: "Recepción",
      last_name: "Prueba (solo Norte)",
      role: receptionistRoleId,
      status: "active",
    } as never),
  )) as { id: string };
  await client.request(
    createItem("clinics_directus_users" as never, { clinics_id: norteClinicId, directus_users_id: receptionSingle.id } as never),
  );
  console.log("✓ Cuentas de recepcionistas de prueba creadas y vinculadas");

  console.log("\n=== Resumen cuentas de prueba ===");
  console.log("Contraseña de todas:", TEST_PASSWORD);
  console.log(`  - doctora.prueba1@${EMAIL_DOMAIN} (Clínica Norte + Clínica Sur — le sale el selector de clínica)`);
  console.log(`  - doctora.prueba2@${EMAIL_DOMAIN} (solo Clínica Norte)`);
  console.log(`  - recepcion.prueba.multi@${EMAIL_DOMAIN} (Clínica Norte + Clínica Sur)`);
  console.log(`  - recepcion.prueba.norte@${EMAIL_DOMAIN} (solo Clínica Norte)`);
  console.log(`Clínica Sur (prueba) id: ${sur.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
