import { readItems } from "@directus/sdk";
import { directus, type ServiceRow } from "../directus.js";
import type { Service } from "../domain/types.js";

function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    nombre: row.nombre,
    duracionMin: row.duracion_min,
    bufferMin: row.buffer_min,
    activo: row.activo,
    specialtyId: row.specialty,
  };
}

/** Catálogo de servicios activos de una clínica, opcionalmente acotado a una especialidad. */
export async function listActiveServices(clinicId: string, specialtyId?: string): Promise<Service[]> {
  const rows = await directus.request(
    readItems("services", {
      filter: {
        activo: { _eq: true },
        clinic: { _eq: clinicId },
        ...(specialtyId ? { specialty: { _eq: specialtyId } } : {}),
      },
      limit: -1,
    }),
  );
  return rows.map(toService);
}

/** Solo resuelve si el servicio pertenece a `clinicId` — evita que un id de otra clínica se filtre. */
export async function getService(id: string, clinicId: string): Promise<Service> {
  const rows = await directus.request(
    readItems("services", { filter: { id: { _eq: id }, clinic: { _eq: clinicId } }, limit: 1 }),
  );
  const row = rows[0];
  if (!row) throw new Error(`Servicio no encontrado: ${id}`);
  return toService(row);
}
