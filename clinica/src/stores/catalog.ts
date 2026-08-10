import { ref } from "vue";
import { defineStore } from "pinia";
import { readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { ClinicDoctor, ServiceRow, SpecialtyRow } from "@/lib/directus";
import { loadClinicDoctors } from "@/lib/clinicDoctors";
import { useClinicaStore } from "@/stores/clinica";

/** Especialidades, médicos y servicios activos: listas chicas y estables, se cargan una vez por sesión. */
export const useCatalogStore = defineStore("catalog", () => {
  const specialties = ref<SpecialtyRow[]>([]);
  /** Médicos que atienden en la clínica activa, ya aplanados desde `clinics_doctors` (ver lib/clinicDoctors.ts). */
  const doctors = ref<ClinicDoctor[]>([]);
  const services = ref<ServiceRow[]>([]);
  const loaded = ref(false);
  let loadingPromise: Promise<void> | null = null;

  async function load(): Promise<void> {
    if (loaded.value) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      const clinicId = useClinicaStore().activeClinicId ?? undefined;
      const [sp, d, s] = await Promise.all([
        directus.request(
          readItems("specialties", {
            filter: { activo: { _eq: true }, clinic: { _eq: clinicId } },
            sort: ["nombre"],
            limit: -1,
          }),
        ),
        loadClinicDoctors(clinicId, { soloActivos: true }),
        directus.request(
          readItems("services", {
            filter: { activo: { _eq: true }, clinic: { _eq: clinicId } },
            sort: ["nombre"],
            limit: -1,
          }),
        ),
      ]);
      specialties.value = sp;
      doctors.value = d;
      services.value = s;
      loaded.value = true;
    })();

    return loadingPromise;
  }

  function doctorName(id: string): string {
    return doctors.value.find((d) => d.id === id)?.nombre ?? "(médico)";
  }

  function serviceName(id: string): string {
    return services.value.find((s) => s.id === id)?.nombre ?? "(servicio)";
  }

  function specialtyName(id: string): string {
    return specialties.value.find((s) => s.id === id)?.nombre ?? "(especialidad)";
  }

  /** Médicos de una especialidad (o todos si no se indica). */
  function doctorsBySpecialty(specialtyId?: string): ClinicDoctor[] {
    if (!specialtyId) return doctors.value;
    return doctors.value.filter((d) => d.specialty === specialtyId);
  }

  /** Servicios de una especialidad (o todos si no se indica), ordenados por duración ascendente y, en empate, alfabéticamente. */
  function servicesBySpecialty(specialtyId?: string): ServiceRow[] {
    const list = specialtyId ? services.value.filter((s) => s.specialty === specialtyId) : services.value.slice();
    return list.sort((a, b) => a.duracion_min - b.duracion_min || a.nombre.localeCompare(b.nombre));
  }

  /** Limpia la caché: necesario al cambiar de cuenta en la misma pestaña, para no arrastrar la lista (y sus permisos) del usuario anterior. */
  function reset(): void {
    specialties.value = [];
    doctors.value = [];
    services.value = [];
    loaded.value = false;
    loadingPromise = null;
  }

  return {
    specialties,
    doctors,
    services,
    loaded,
    load,
    reset,
    doctorName,
    serviceName,
    specialtyName,
    doctorsBySpecialty,
    servicesBySpecialty,
  };
});
