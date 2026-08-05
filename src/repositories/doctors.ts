import { readItems } from "@directus/sdk";
import { directus, type ClinicDoctorRow, type DoctorRow } from "../directus.js";
import type { Doctor } from "../domain/types.js";

/**
 * Un médico puede trabajar en varias clínicas (M2M `clinics_doctors`), y su
 * especialidad depende de cuál — `specialties` es clinic-scoped. Por eso el
 * `specialtyId` que devuelven estas funciones es siempre "el de esta clínica",
 * y el mismo médico puede salir con especialidades distintas en dos clínicas.
 *
 * Se consulta en dos pasos en vez de con deep fields porque las claves foráneas
 * del `Schema` están tipadas como string plano (ver src/directus.ts), así que
 * el SDK no acepta un `fields: ["doctors_id.nombre"]` tipado. A esta escala
 * (listas chicas) las dos consultas no cuestan nada.
 */
function toDoctor(row: DoctorRow, specialtyId: string): Doctor {
  return { id: row.id, nombre: row.nombre, activo: row.activo, specialtyId };
}

/** Médicos activos de una clínica, opcionalmente acotados a una especialidad, para ofrecer como opción o iterar disponibilidad. */
export async function listActiveDoctors(clinicId: string, specialtyId?: string): Promise<Doctor[]> {
  const links = await directus.request(
    readItems("clinics_doctors", {
      filter: {
        clinics_id: { _eq: clinicId },
        activo: { _eq: true },
        ...(specialtyId ? { specialty: { _eq: specialtyId } } : {}),
      },
      limit: -1,
    }),
  );
  if (links.length === 0) return [];

  const rows = await directus.request(
    readItems("doctors", {
      filter: { id: { _in: links.map((l) => l.doctors_id) }, activo: { _eq: true } },
      limit: -1,
    }),
  );
  const specialtyByDoctor = new Map(links.map((l) => [l.doctors_id, l.specialty]));

  return rows.map((row) => toDoctor(row, specialtyByDoctor.get(row.id)!));
}

/**
 * Solo resuelve si el médico trabaja en `clinicId` — evita que un id de otra
 * clínica se filtre. No exige que el vínculo esté activo: también se usa para
 * nombrar al médico de citas ya creadas (recordatorios, lista de espera), que
 * siguen existiendo aunque se le haya dado de baja en la clínica.
 */
export async function getDoctor(id: string, clinicId: string): Promise<Doctor> {
  const links: ClinicDoctorRow[] = await directus.request(
    readItems("clinics_doctors", {
      filter: { doctors_id: { _eq: id }, clinics_id: { _eq: clinicId } },
      limit: 1,
    }),
  );
  const link = links[0];
  if (!link) throw new Error(`Médico no encontrado: ${id}`);

  const rows = await directus.request(readItems("doctors", { filter: { id: { _eq: id } }, limit: 1 }));
  const row = rows[0];
  if (!row) throw new Error(`Médico no encontrado: ${id}`);

  return toDoctor(row, link.specialty);
}
