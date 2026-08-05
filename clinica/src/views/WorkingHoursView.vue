<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { deleteItem, readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { IsoWeekday, WorkingHoursRow } from "@/lib/directus";
import { useAuthStore } from "@/stores/auth";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useConfirm } from "@/composables/useConfirm";
import Button from "@/components/ui/Button.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";
import AddWorkingHoursModal from "@/components/AddWorkingHoursModal.vue";

const auth = useAuthStore();
const catalog = useCatalogStore();
const clinica = useClinicaStore();
const confirm = useConfirm();

const DIAS: { value: IsoWeekday; label: string }[] = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 7, label: "Domingo" },
];

const doctorId = ref("");
const workingHours = ref<WorkingHoursRow[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const showModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingRow = ref<WorkingHoursRow | undefined>(undefined);
const modalInitialDia = ref<IsoWeekday | undefined>(undefined);

const groupedByDay = computed(() => {
  const map = new Map<IsoWeekday, WorkingHoursRow[]>();
  for (const d of DIAS) map.set(d.value, []);
  for (const row of workingHours.value) {
    map.get(row.dia_semana)?.push(row);
  }
  for (const rows of map.values()) rows.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
  return map;
});

function toHm(t: string): string {
  return t.slice(0, 5);
}

async function load(): Promise<void> {
  if (!doctorId.value) {
    workingHours.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    // Acotado a la clínica activa: el mismo médico puede tener un horario
    // distinto en cada clínica donde trabaja.
    workingHours.value = await directus.request(
      readItems("working_hours", {
        filter: { doctor: { _eq: doctorId.value }, clinic: { _eq: clinica.activeClinicId ?? undefined } },
        limit: -1,
      }),
    );
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo cargar el horario.");
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await catalog.load();
  // El médico edita su propio horario: se resuelve por su identidad, no por el
  // primero de la lista (que con médicos multi-clínica ya no es equivalente).
  if (!auth.isReceptionist && !auth.isAdmin && auth.ownDoctorId) {
    doctorId.value = auth.ownDoctorId;
  }
  await load();
});

function openCreate(dia?: IsoWeekday): void {
  modalMode.value = "create";
  editingRow.value = undefined;
  modalInitialDia.value = dia;
  showModal.value = true;
}

function openEdit(row: WorkingHoursRow): void {
  modalMode.value = "edit";
  editingRow.value = row;
  modalInitialDia.value = undefined;
  showModal.value = true;
}

async function handleSaved(): Promise<void> {
  showModal.value = false;
  await load();
}

async function removeBlock(row: WorkingHoursRow): Promise<void> {
  const ok = await confirm({
    title: "Eliminar este bloque de horario",
    message: "Se eliminará este bloque del horario laboral. Esta acción no se puede deshacer.",
  });
  if (!ok) return;
  error.value = null;
  try {
    await directus.request(deleteItem("working_hours", row.id));
    await load();
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo eliminar el horario.");
  }
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 class="font-display text-xl font-bold text-brand-800">Horario laboral</h1>
      <Button v-if="doctorId" @click="openCreate()">+ Agregar horario</Button>
    </div>

    <div v-if="auth.isReceptionist || auth.isAdmin" class="mb-6">
      <label class="mb-1 block text-sm font-medium text-slate-700">Médico</label>
      <select
        v-model="doctorId"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-64"
        @change="load"
      >
        <option value="" disabled>Selecciona un médico</option>
        <option v-for="d in catalog.doctors" :key="d.id" :value="d.id">{{ d.nombre }}</option>
      </select>
    </div>

    <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>
    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>

    <template v-else-if="doctorId">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <div v-for="dia in DIAS" :key="dia.value" class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{{ dia.label }}</h2>

          <div class="space-y-1.5">
            <p v-if="groupedByDay.get(dia.value)?.length === 0" class="py-2 text-center text-xs text-slate-300">
              Sin horario
            </p>
            <div
              v-for="row in groupedByDay.get(dia.value)"
              :key="row.id"
              class="flex items-center justify-between gap-1 rounded-lg bg-brand-50 px-2 py-1.5 text-xs font-medium text-brand-800"
            >
              <span>{{ toHm(row.hora_inicio) }}–{{ toHm(row.hora_fin) }}</span>
              <div class="flex flex-none items-center gap-0.5">
                <button
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded text-brand-600 hover:bg-brand-100"
                  aria-label="Editar"
                  @click="openEdit(row)"
                >
                  <span class="h-3 w-3"><ActionIcon name="edit" /></span>
                </button>
                <button
                  type="button"
                  class="flex h-5 w-5 items-center justify-center rounded text-red-500 hover:bg-red-100"
                  aria-label="Eliminar"
                  @click="removeBlock(row)"
                >
                  <span class="h-3 w-3"><ActionIcon name="trash" /></span>
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-medium text-slate-400 transition hover:border-brand-300 hover:text-brand-600"
            @click="openCreate(dia.value)"
          >
            + Agregar
          </button>
        </div>
      </div>
    </template>

    <p v-else class="text-sm text-slate-500">Selecciona un médico para ver y editar su horario.</p>

    <AddWorkingHoursModal
      v-if="showModal"
      :doctor-id="doctorId"
      :mode="modalMode"
      :row="editingRow"
      :initial-dia="modalInitialDia"
      @close="showModal = false"
      @saved="handleSaved"
    />
  </div>
</template>
