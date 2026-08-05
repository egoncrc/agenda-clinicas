<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { deleteItem, readItems } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus } from "@/lib/directus";
import type { TimeOffRow } from "@/lib/directus";
import { useAuthStore } from "@/stores/auth";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useConfirm } from "@/composables/useConfirm";
import Button from "@/components/ui/Button.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";
import TimeOffFormModal from "@/components/TimeOffFormModal.vue";

const auth = useAuthStore();
const catalog = useCatalogStore();
const clinica = useClinicaStore();
const confirm = useConfirm();

const doctorId = ref("");
const timeOff = ref<TimeOffRow[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const showModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingRow = ref<TimeOffRow | undefined>(undefined);
/** Aviso tras guardar una ausencia que canceló citas: recuerda el paso manual que queda pendiente. */
const cancelNotice = ref<string | null>(null);

function formatRange(row: TimeOffRow): string {
  const inicio = DateTime.fromISO(row.inicio, { zone: CLINIC_TIMEZONE }).setLocale("es");
  const fin = DateTime.fromISO(row.fin, { zone: CLINIC_TIMEZONE }).setLocale("es");
  const sameDay = inicio.hasSame(fin, "day");
  return sameDay
    ? `${inicio.toFormat("d LLL yyyy")}, ${inicio.toFormat("HH:mm")} – ${fin.toFormat("HH:mm")}`
    : `${inicio.toFormat("d LLL yyyy, HH:mm")} – ${fin.toFormat("d LLL yyyy, HH:mm")}`;
}

async function load(): Promise<void> {
  if (!doctorId.value) {
    timeOff.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    // Acotado a la clínica activa: una ausencia bloquea solo la sede donde se
    // registró, así que las de otra clínica no son asunto de esta pantalla.
    timeOff.value = await directus.request(
      readItems("time_off", {
        filter: { doctor: { _eq: doctorId.value }, clinic: { _eq: clinica.activeClinicId ?? undefined } },
        sort: ["-inicio"],
        limit: -1,
      }),
    );
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudieron cargar las suspensiones.");
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await catalog.load();
  // El médico ve sus propias ausencias: se resuelve por su identidad, no por el
  // primero de la lista. El admin no entra acá (usa el selector, igual que
  // recepción) — antes caía en el primer médico de la clínica sin poder cambiarlo.
  if (!auth.isReceptionist && !auth.isAdmin && auth.ownDoctorId) {
    doctorId.value = auth.ownDoctorId;
  }
  await load();
});

function openCreate(): void {
  modalMode.value = "create";
  editingRow.value = undefined;
  cancelNotice.value = null;
  showModal.value = true;
}

function openEdit(row: TimeOffRow): void {
  modalMode.value = "edit";
  editingRow.value = row;
  cancelNotice.value = null;
  showModal.value = true;
}

async function handleSaved(canceladas: number): Promise<void> {
  showModal.value = false;
  cancelNotice.value =
    canceladas > 0
      ? `Se cancelaron ${canceladas} ${canceladas === 1 ? "cita" : "citas"} en ese periodo. Avise a los pacientes desde la pantalla Mensajes.`
      : null;
  await load();
}

async function removeBlock(row: TimeOffRow): Promise<void> {
  const ok = await confirm({
    title: "Eliminar esta suspensión",
    message: "Se eliminará este bloque de suspensión. Los horarios de esos días volverán a estar disponibles.",
  });
  if (!ok) return;
  error.value = null;
  try {
    await directus.request(deleteItem("time_off", row.id));
    await load();
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo eliminar la suspensión.");
  }
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 class="font-display text-xl font-bold text-brand-800">Suspensiones</h1>
      <Button v-if="doctorId" @click="openCreate">+ Agregar suspensión</Button>
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

    <div
      v-if="cancelNotice"
      class="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      <span>{{ cancelNotice }}</span>
      <RouterLink
        v-if="auth.isReceptionist"
        to="/mensajes"
        class="flex-none font-medium underline underline-offset-2"
      >
        Ir a Mensajes
      </RouterLink>
    </div>

    <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>
    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>

    <template v-else-if="doctorId">
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <EmptyState v-if="timeOff.length === 0" title="Sin suspensiones registradas" />
        <ul v-else class="divide-y divide-slate-100">
          <li v-for="row in timeOff" :key="row.id" class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span class="font-medium text-slate-700">{{ formatRange(row) }}</span>
              <span v-if="row.motivo" class="text-slate-400 italic">— {{ row.motivo }}</span>
            </div>
            <div class="flex flex-none items-center gap-1">
              <button
                type="button"
                class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-brand-700"
                aria-label="Editar"
                @click="openEdit(row)"
              >
                <span class="h-4 w-4"><ActionIcon name="edit" /></span>
              </button>
              <button
                type="button"
                class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                aria-label="Eliminar"
                @click="removeBlock(row)"
              >
                <span class="h-4 w-4"><ActionIcon name="trash" /></span>
              </button>
            </div>
          </li>
        </ul>
      </div>
    </template>

    <p v-else class="text-sm text-slate-500">Selecciona un médico para ver y editar sus suspensiones.</p>

    <TimeOffFormModal
      v-if="showModal"
      :doctor-id="doctorId"
      :mode="modalMode"
      :row="editingRow"
      @close="showModal = false"
      @saved="handleSaved"
    />
  </div>
</template>
