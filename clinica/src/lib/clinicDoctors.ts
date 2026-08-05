import { readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { ClinicDoctor } from "@/lib/directus";

/**
 * Un médico puede trabajar en varias clínicas: su identidad vive en `doctors`
 * y lo que depende de la sede (especialidad, alta/baja) en la tabla puente
 * `clinics_doctors`. Todas las pantallas necesitan el mismo aplanado de las dos
 * cosas, así que se hace una sola vez acá.
 *
 * Se consulta en dos pasos en vez de con deep fields porque las claves foráneas
 * del `Schema` están tipadas como string plano (mismo criterio que el bot, ver
 * src/repositories/doctors.ts). Son listas chicas: no cuesta nada.
 */
export async function loadClinicDoctors(
  clinicId: string | undefined,
  options: { soloActivos?: boolean } = {},
): Promise<ClinicDoctor[]> {
  if (!clinicId) return [];

  const links = await directus.request(
    readItems("clinics_doctors", {
      filter: {
        clinics_id: { _eq: clinicId },
        ...(options.soloActivos ? { activo: { _eq: true } } : {}),
      },
      limit: -1,
    }),
  );
  if (links.length === 0) return [];

  const rows = await directus.request(
    readItems("doctors", {
      filter: {
        id: { _in: links.map((l) => l.doctors_id) },
        ...(options.soloActivos ? { activo: { _eq: true } } : {}),
      },
      sort: ["nombre"],
      limit: -1,
    }),
  );
  const linkByDoctor = new Map(links.map((l) => [l.doctors_id, l]));

  return rows.flatMap((row) => {
    const link = linkByDoctor.get(row.id);
    if (!link) return [];
    return [
      {
        id: row.id,
        nombre: row.nombre,
        activo: row.activo && link.activo,
        usuario: row.usuario,
        specialty: link.specialty,
        linkId: link.id,
      },
    ];
  });
}
