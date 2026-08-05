import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { ClinicRow } from "@/lib/directus";

/** Persistida en sessionStorage: sobrevive un refresh en la misma pestaña sin volver a preguntar. */
const STORAGE_KEY = "clinica-dental:activeClinicId";

/** Clínicas a las que está vinculado el usuario logueado, y cuál está activa (la que scoped todas las consultas del panel). */
export const useClinicaStore = defineStore("clinica", () => {
  const clinics = ref<ClinicRow[]>([]);
  const activeClinicId = ref<string | null>(sessionStorage.getItem(STORAGE_KEY));
  const loaded = ref(false);

  const activeClinic = computed(() => clinics.value.find((c) => c.id === activeClinicId.value) ?? null);
  /** true cuando el usuario tiene más de una clínica y todavía no eligió con cuál trabajar. */
  const needsSelection = computed(() => loaded.value && clinics.value.length > 1 && !activeClinicId.value);

  /** Se llama una vez tras resolver la sesión: trae las clínicas del usuario (Directus ya las filtra a las propias) y autoselecciona si solo hay una. */
  async function loadClinics(): Promise<void> {
    clinics.value = await directus.request(
      readItems("clinics", { filter: { activo: { _eq: true } }, sort: ["nombre"], limit: -1 }),
    );
    loaded.value = true;

    if (clinics.value.length === 1) {
      selectClinic(clinics.value[0]!.id);
    } else if (activeClinicId.value && !clinics.value.some((c) => c.id === activeClinicId.value)) {
      // La clínica guardada en esta pestaña ya no es válida para este usuario (ej. cambió de cuenta sin logout).
      clearSelection();
    }
  }

  function selectClinic(id: string): void {
    activeClinicId.value = id;
    sessionStorage.setItem(STORAGE_KEY, id);
  }

  function clearSelection(): void {
    activeClinicId.value = null;
    sessionStorage.removeItem(STORAGE_KEY);
  }

  /** Necesario al cambiar de cuenta en la misma pestaña (login/logout), mismo criterio que catalog.reset(). */
  function reset(): void {
    clinics.value = [];
    loaded.value = false;
    clearSelection();
  }

  return {
    clinics,
    activeClinicId,
    activeClinic,
    loaded,
    needsSelection,
    loadClinics,
    selectClinic,
    clearSelection,
    reset,
  };
});
