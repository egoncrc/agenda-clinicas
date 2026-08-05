import { readItems } from "@directus/sdk";
import { directus, type SpecialtyRow } from "../directus.js";
import type { Specialty } from "../domain/types.js";

function toSpecialty(row: SpecialtyRow): Specialty {
  return { id: row.id, nombre: row.nombre, activo: row.activo };
}

/** Especialidades activas de una clínica, para ofrecer como primer paso al agendar. */
export async function listActiveSpecialties(clinicId: string): Promise<Specialty[]> {
  const rows = await directus.request(
    readItems("specialties", { filter: { activo: { _eq: true }, clinic: { _eq: clinicId } }, limit: -1 }),
  );
  return rows.map(toSpecialty);
}

/** Solo resuelve si la especialidad pertenece a `clinicId` — evita que un id de otra clínica se filtre. */
export async function getSpecialty(id: string, clinicId: string): Promise<Specialty> {
  const rows = await directus.request(
    readItems("specialties", { filter: { id: { _eq: id }, clinic: { _eq: clinicId } }, limit: 1 }),
  );
  const row = rows[0];
  if (!row) throw new Error(`Especialidad no encontrada: ${id}`);
  return toSpecialty(row);
}
