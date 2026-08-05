import { readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { ClinicDoctor, ServiceRow, SpecialtyRow } from "@/lib/directus";
import { loadClinicDoctors } from "@/lib/clinicDoctors";
import type { ReportContext } from "./types";

/**
 * Construye el diccionario de nombres de una corrida de reportes.
 *
 * NO reutiliza el store `catalog` a propósito: ese cachea solo lo ACTIVO de la
 * clínica activa, que es justo lo que un reporte histórico no puede asumir. Una
 * cita de marzo puede ser de un médico dado de baja en abril o de un servicio
 * retirado del catálogo, y salir como "(médico)" convierte el reporte en basura.
 * Aquí se lee sin filtro de `activo` y para todas las sedes consultadas.
 *
 * Son 4 consultas de listas chicas, una vez por corrida.
 */
export async function buildReportContext(clinicIds: string[]): Promise<ReportContext> {
  const [clinics, specialties, services, doctorLists] = await Promise.all([
    directus.request(readItems("clinics", { filter: { id: { _in: clinicIds } }, limit: -1 })),
    directus.request(readItems("specialties", { filter: { clinic: { _in: clinicIds } }, limit: -1 })),
    directus.request(readItems("services", { filter: { clinic: { _in: clinicIds } }, limit: -1 })),
    Promise.all(clinicIds.map((id) => loadClinicDoctors(id, { soloActivos: false }))),
  ]);

  // Un médico multi-sede aparece una vez por clínica: se deduplica por id de
  // persona (la identidad es única, ver `clinics_doctors` en CLAUDE.md). Gana la
  // primera aparición para la especialidad, que solo se usa en ocupación.
  const doctorById = new Map<string, ClinicDoctor>();
  for (const list of doctorLists) {
    for (const d of list) if (!doctorById.has(d.id)) doctorById.set(d.id, d);
  }
  // Alfabético ascendente: es el orden de lectura de toda la sección de
  // Reportes (tablas, gráficos y también estos mismos selectores de filtro).
  const doctors = [...doctorById.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const sortedSpecialties = [...specialties].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const sortedServices = [...services].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const clinicNames = new Map(clinics.map((c) => [c.id, c.nombre]));
  const specialtyNames = new Map(specialties.map((s) => [s.id, s.nombre]));
  const serviceById = new Map<string, ServiceRow>(services.map((s) => [s.id, s]));

  return {
    clinicIds,
    doctors,
    services: sortedServices,
    specialties: sortedSpecialties as SpecialtyRow[],
    clinicName: (id) => clinicNames.get(id) ?? "(clínica)",
    doctorName: (id) => doctorById.get(id)?.nombre ?? "(médico)",
    serviceName: (id) => serviceById.get(id)?.nombre ?? "(servicio)",
    specialtyName: (id) => specialtyNames.get(id) ?? "(especialidad)",
    specialtyOfService: (id) => serviceById.get(id)?.specialty ?? null,
    specialtyOfDoctor: (id) => doctorById.get(id)?.specialty ?? null,
  };
}
