<script setup lang="ts">
/**
 * Vincula a esta clínica un médico que ya existe en otra. Es la pieza que hace
 * real el multi-clínica: en vez de crear una segunda ficha (que sería otra
 * identidad, y entonces nada impediría agendarlo a la misma hora en las dos
 * sedes), se reutiliza la misma fila `doctors` y solo se agrega la fila puente
 * con la especialidad que tiene acá.
 */
import { computed, onMounted, ref } from "vue";
import { createItem, readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { DoctorRow, SpecialtyRow } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import Button from "@/components/ui/Button.vue";

const props = defineProps<{
  clinicId: string;
  specialties: SpecialtyRow[];
  /** Ids de médicos ya vinculados a esta clínica: no tiene sentido ofrecerlos. */
  yaVinculados: string[];
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const INPUT = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

const candidatos = ref<DoctorRow[]>([]);
const busqueda = ref("");
const doctorId = ref("");
const specialty = ref(props.specialties[0]?.id ?? "");
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase();
  return q ? candidatos.value.filter((d) => d.nombre.toLowerCase().includes(q)) : candidatos.value;
});

onMounted(async () => {
  try {
    const rows = await directus.request(
      readItems("doctors", { filter: { activo: { _eq: true } }, sort: ["nombre"], limit: -1 }),
    );
    const excluidos = new Set(props.yaVinculados);
    candidatos.value = rows.filter((d) => !excluidos.has(d.id));
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo cargar la lista de médicos.");
  } finally {
    loading.value = false;
  }
});

async function handleSubmit(): Promise<void> {
  error.value = null;
  if (!doctorId.value) {
    error.value = "Elegí un médico.";
    return;
  }
  if (!specialty.value) {
    error.value = "Elegí la especialidad que tendrá en esta clínica.";
    return;
  }
  saving.value = true;
  try {
    await directus.request(
      createItem("clinics_doctors", {
        clinics_id: props.clinicId,
        doctors_id: doctorId.value,
        specialty: specialty.value,
        activo: true,
      }),
    );
    emit("saved");
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo vincular al médico.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-1 text-lg font-bold text-brand-800">Vincular médico existente</h2>
      <p class="mb-4 text-xs text-slate-500">
        Para un médico que ya atiende en otra clínica. Mantiene una sola ficha, con horario y
        especialidad propios en cada sede.
      </p>

      <p v-if="loading" class="text-sm text-slate-500">Cargando…</p>

      <form v-else class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Buscar</label>
          <input v-model="busqueda" :class="INPUT" placeholder="Nombre del médico" />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Médico</label>
          <select v-model="doctorId" :class="INPUT" size="6">
            <option v-for="d in filtrados" :key="d.id" :value="d.id">{{ d.nombre }}</option>
          </select>
          <p v-if="filtrados.length === 0" class="mt-1 text-xs text-slate-400">
            No hay médicos disponibles para vincular.
          </p>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Especialidad en esta clínica</label>
          <select v-model="specialty" :class="INPUT">
            <option v-for="s in specialties" :key="s.id" :value="s.id">{{ s.nombre }}</option>
          </select>
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="secondary" @click="emit('close')">Cancelar</Button>
          <Button type="submit" :loading="saving">{{ saving ? "Vinculando…" : "Vincular" }}</Button>
        </div>
      </form>
    </div>
  </div>
</template>
