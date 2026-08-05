<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { readItems, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus } from "@/lib/directus";
import type { AppointmentRow, PatientRow, WaitlistRow, WaitlistStatus } from "@/lib/directus";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { CLINIC_TIMEZONE, formatDateTime } from "@/lib/dateRanges";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useConfirm } from "@/composables/useConfirm";
import WaitlistFormModal from "@/components/WaitlistFormModal.vue";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";

const catalog = useCatalogStore();
const clinica = useClinicaStore();
const confirm = useConfirm();

const DIA_LABELS: Record<number, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
  7: "domingo",
};

const ESTADO_LABELS: Record<WaitlistStatus, string> = {
  activa: "Activa",
  ofrecida: "Ofrecida",
  agendada: "Agendada",
  cancelada: "Cancelada",
};

const ESTADO_TONE: Record<WaitlistStatus, "success" | "warn" | "danger" | "neutral" | "info"> = {
  activa: "warn",
  ofrecida: "info",
  agendada: "success",
  cancelada: "neutral",
};

function describePreference(e: WaitlistRow): string {
  const dia = e.dia_semana ? DIA_LABELS[e.dia_semana] : "cualquier día";
  const desde = e.hora_desde?.slice(0, 5);
  const hasta = e.hora_hasta?.slice(0, 5);
  let hora = "cualquier hora";
  if (desde && hasta) hora = `entre las ${desde} y las ${hasta}`;
  else if (desde) hora = `después de las ${desde}`;
  else if (hasta) hora = `antes de las ${hasta}`;
  return `${dia}, ${hora}`;
}

const estadoFilter = ref<WaitlistStatus | "">("activa");
const serviceFilter = ref("");
const doctorFilter = ref("");

const entries = ref<WaitlistRow[]>([]);
const patientNames = ref<Record<string, string>>({});
/** Fecha/hora de la cita generada, para las entradas ya agendadas. */
const generatedAppointmentDates = ref<Record<string, string>>({});
const loading = ref(true);
const error = ref<string | null>(null);

const showModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingEntry = ref<WaitlistRow | undefined>(undefined);

const sortedEntries = computed(() =>
  [...entries.value].sort((a, b) => (b.date_created ?? "").localeCompare(a.date_created ?? "")),
);

let loadInFlight = false;

async function load(opts: { silent?: boolean } = {}): Promise<void> {
  if (loadInFlight) return;
  loadInFlight = true;
  if (!opts.silent) loading.value = true;
  error.value = null;
  try {
    await catalog.load();

    const filter: Record<string, unknown> = { clinic: { _eq: clinica.activeClinicId ?? undefined } };
    if (estadoFilter.value) filter.estado = { _eq: estadoFilter.value };
    if (serviceFilter.value) filter.service = { _eq: serviceFilter.value };
    if (doctorFilter.value) filter.doctor = { _eq: doctorFilter.value };

    entries.value = await directus.request(
      readItems("waitlist", { filter, sort: ["-date_created"], limit: -1 }),
    );

    const patientIds = [...new Set(entries.value.map((e) => e.patient))];
    if (patientIds.length > 0) {
      const patients: Pick<PatientRow, "id" | "nombre" | "telefono">[] = await directus.request(
        readItems("patients", { filter: { id: { _in: patientIds } }, fields: ["id", "nombre", "telefono"] }),
      );
      patientNames.value = Object.fromEntries(patients.map((p) => [p.id, p.nombre?.trim() || p.telefono]));
    } else {
      patientNames.value = {};
    }

    const appointmentIds = entries.value
      .map((e) => e.appointment_generada)
      .filter((id): id is string => Boolean(id));
    if (appointmentIds.length > 0) {
      const appointments: AppointmentRow[] = await directus.request(
        readItems("appointments", { filter: { id: { _in: appointmentIds } } }),
      );
      generatedAppointmentDates.value = Object.fromEntries(
        appointments.map((a) => [a.id, formatDateTime(new Date(a.inicio))]),
      );
    } else {
      generatedAppointmentDates.value = {};
    }
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudieron cargar las entradas de lista de espera.");
  } finally {
    if (!opts.silent) loading.value = false;
    loadInFlight = false;
  }
}

/**
 * El bot agenda/ofrece/expira entradas por fuera del panel, así que se
 * refresca sola por polling silencioso (mismo patrón que AppointmentsView).
 */
const POLL_INTERVAL_MS = 15_000;
let pollTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  await load();
  pollTimer = setInterval(() => {
    if (!showModal.value) void load({ silent: true });
  }, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

watch([estadoFilter, serviceFilter, doctorFilter], () => load());

function openCreate(): void {
  modalMode.value = "create";
  editingEntry.value = undefined;
  showModal.value = true;
}

function openEdit(entry: WaitlistRow): void {
  modalMode.value = "edit";
  editingEntry.value = entry;
  showModal.value = true;
}

async function handleSaved(): Promise<void> {
  showModal.value = false;
  await load({ silent: true });
}

async function quickCancel(entry: WaitlistRow): Promise<void> {
  const ok = await confirm({
    title: "Dar de baja esta entrada",
    message: "Esta entrada saldrá de la lista de espera. Esta acción no se puede deshacer.",
    confirmLabel: "Dar de baja",
  });
  if (!ok) return;
  try {
    await directus.request(updateItem("waitlist", entry.id, { estado: "cancelada" }));
    await load({ silent: true });
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo dar de baja la entrada.");
  }
}

function formatOferta(e: WaitlistRow): string | null {
  if (e.estado !== "ofrecida" || !e.oferta_inicio) return null;
  return formatDateTime(DateTime.fromISO(e.oferta_inicio, { zone: CLINIC_TIMEZONE }).toJSDate());
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 class="font-display text-xl font-bold text-brand-800">Lista de espera</h1>
      <Button @click="openCreate">+ Nueva entrada</Button>
    </div>

    <p class="mb-4 text-sm text-slate-500">
      Pacientes esperando una cancelación. Cuando se libera un cupo compatible, se les ofrece automáticamente por
      WhatsApp y se agenda si confirman.
    </p>

    <div class="mb-4 flex flex-wrap gap-3">
      <select
        v-model="estadoFilter"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      >
        <option value="">Todos los estados</option>
        <option v-for="(label, value) in ESTADO_LABELS" :key="value" :value="value">{{ label }}</option>
      </select>
      <select
        v-model="serviceFilter"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      >
        <option value="">Todos los servicios</option>
        <option v-for="s in catalog.services" :key="s.id" :value="s.id">{{ s.nombre }}</option>
      </select>
      <select
        v-model="doctorFilter"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      >
        <option value="">Todos los médicos</option>
        <option v-for="d in catalog.doctors" :key="d.id" :value="d.id">{{ d.nombre }}</option>
      </select>
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>
    <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <EmptyState v-if="sortedEntries.length === 0" title="No hay entradas de lista de espera para este filtro" />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50">
            <tr>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Paciente</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Servicio</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Médico</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Preferencia</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</th>
              <th class="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="e in sortedEntries" :key="e.id" class="transition hover:bg-slate-50">
              <td class="px-4 py-2.5 text-slate-700">{{ patientNames[e.patient] ?? "…" }}</td>
              <td class="px-4 py-2.5 text-slate-600">{{ catalog.serviceName(e.service) }}</td>
              <td class="px-4 py-2.5 text-slate-600">{{ e.doctor ? catalog.doctorName(e.doctor) : "Cualquiera" }}</td>
              <td class="px-4 py-2.5 text-slate-600">{{ describePreference(e) }}</td>
              <td class="px-4 py-2.5">
                <Badge :tone="ESTADO_TONE[e.estado]">{{ ESTADO_LABELS[e.estado] }}</Badge>
                <p v-if="formatOferta(e)" class="mt-1 text-xs text-slate-500">Ofrecido: {{ formatOferta(e) }}</p>
                <p v-if="e.estado === 'agendada' && e.appointment_generada" class="mt-1 text-xs text-slate-500">
                  Cita: {{ generatedAppointmentDates[e.appointment_generada] ?? "…" }}
                </p>
              </td>
              <td class="px-4 py-2.5">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-brand-700"
                    title="Editar"
                    aria-label="Editar"
                    @click="openEdit(e)"
                  >
                    <span class="h-4 w-4"><ActionIcon name="edit" /></span>
                  </button>
                  <button
                    v-if="e.estado !== 'cancelada' && e.estado !== 'agendada'"
                    type="button"
                    class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    title="Dar de baja"
                    aria-label="Dar de baja"
                    @click="quickCancel(e)"
                  >
                    <span class="h-4 w-4"><ActionIcon name="trash" /></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <WaitlistFormModal
      v-if="showModal"
      :mode="modalMode"
      :entry="editingEntry"
      @close="showModal = false"
      @saved="handleSaved"
    />
  </div>
</template>
