<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { readItems, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus } from "@/lib/directus";
import type { AppointmentRow, PatientRow } from "@/lib/directus";
import { useAuthStore } from "@/stores/auth";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { CLINIC_TIMEZONE, formatDay, formatTime, formatTime12h } from "@/lib/dateRanges";
import { buildConfirmationMessage, waMeLink } from "@/lib/messageTemplates";
import { dateRangeFilter } from "@/lib/queryHelpers";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { ESTADO_LABELS, ESTADO_TONE } from "@/lib/appointmentStatus";
import { useConfirm } from "@/composables/useConfirm";
import AppointmentFormModal from "@/components/AppointmentFormModal.vue";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";

const auth = useAuthStore();
const catalog = useCatalogStore();
const clinica = useClinicaStore();
const confirm = useConfirm();

const dateFilter = ref(DateTime.now().setZone(CLINIC_TIMEZONE).toFormat("yyyy-LL-dd"));
const doctorFilter = ref("");
const estadoFilter = ref("");

type PacienteLite = Pick<PatientRow, "id" | "nombre" | "telefono">;

const appointments = ref<AppointmentRow[]>([]);
const patientsById = ref<Record<string, PacienteLite>>({});
const loading = ref(true);
const error = ref<string | null>(null);

/**
 * Solo edición: agendar vive en su propia pantalla (`/citas/agendar`,
 * `BookAppointmentView.vue`), donde se elige el hueco libre.
 */
const showModal = ref(false);
const editingAppointment = ref<AppointmentRow | undefined>(undefined);

const sortedAppointments = computed(() =>
  [...appointments.value].sort((a, b) => a.inicio.localeCompare(b.inicio)),
);

const PAGE_SIZE = 5;
const currentPage = ref(1);
const totalPages = computed(() => Math.max(1, Math.ceil(sortedAppointments.value.length / PAGE_SIZE)));
const pagedAppointments = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return sortedAppointments.value.slice(start, start + PAGE_SIZE);
});
/** Si la página actual queda fuera de rango (p. ej. al cancelar la última cita de la última página), se ajusta sola en vez de mostrar una tabla vacía con datos aún cargados. */
watch(totalPages, (tp) => {
  if (currentPage.value > tp) currentPage.value = tp;
});

/** Los pacientes que crea el bot solo traen teléfono, así que ese es el nombre visible. */
function patientLabel(id: string): string {
  const p = patientsById.value[id];
  if (!p) return "…";
  return p.nombre?.trim() || p.telefono;
}

/** La especialidad de la cita es la del servicio agendado (no la del médico, que puede atender varias). */
function especialidadName(a: AppointmentRow): string {
  const specialtyId = catalog.services.find((s) => s.id === a.service)?.specialty;
  return specialtyId ? catalog.specialtyName(specialtyId) : "—";
}

const clinicaNombre = computed(() => clinica.activeClinic?.nombre ?? "la clínica");

/**
 * Link de wa.me con el texto de confirmación ya cargado, para que recepción lo
 * envíe a mano mientras la WABA sigue bloqueada (mismo mecanismo que /mensajes).
 * Solo para citas pendientes: son las únicas que hace falta confirmar. Un valor
 * `null` significa teléfono inservible, y la vista muestra el icono deshabilitado.
 */
const waLinks = computed<Record<string, string | null>>(() => {
  const out: Record<string, string | null> = {};
  for (const a of sortedAppointments.value) {
    if (a.estado !== "pendiente") continue;
    const inicio = new Date(a.inicio);
    const p = patientsById.value[a.patient];
    out[a.id] = waMeLink(
      p?.telefono,
      buildConfirmationMessage({
        clinicaNombre: clinicaNombre.value,
        pacienteNombre: p?.nombre?.trim() || null,
        servicioNombre: catalog.serviceName(a.service),
        especialidadNombre: especialidadName(a),
        doctorNombre: catalog.doctorName(a.doctor),
        fechaTexto: formatDay(inicio),
        horaTexto: formatTime12h(inicio),
        telefonoContacto: clinica.activeClinic?.telefono_contacto ?? "",
      }),
    );
  }
  return out;
});

/** Evita solapar una recarga (poll, guardado, filtro) con otra ya en curso. */
let loadInFlight = false;

/**
 * `silent`: evita tocar `loading` para que la tabla no desaparezca mientras se
 * refresca (usado tras editar/cancelar una cita, y en el polling en segundo
 * plano, para que el cambio se vea al instante sin sensación de recarga de
 * pantalla). La carga inicial y los cambios de filtro sí usan el loading normal.
 */
async function load(opts: { silent?: boolean } = {}): Promise<void> {
  if (loadInFlight) return;
  loadInFlight = true;
  if (!opts.silent) loading.value = true;
  error.value = null;
  try {
    await catalog.load();

    const day = DateTime.fromFormat(dateFilter.value, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
    const filter: Record<string, unknown> = {
      clinic: { _eq: clinica.activeClinicId ?? undefined },
      inicio: dateRangeFilter(day.startOf("day").toISO()!, day.endOf("day").toISO()!),
    };
    if (doctorFilter.value) filter.doctor = { _eq: doctorFilter.value };
    if (estadoFilter.value) filter.estado = { _eq: estadoFilter.value };

    appointments.value = await directus.request(
      readItems("appointments", { filter, sort: ["inicio"], limit: -1 }),
    );

    const patientIds = [...new Set(appointments.value.map((a) => a.patient))];
    if (patientIds.length > 0) {
      const patients: PacienteLite[] = await directus.request(
        readItems("patients", {
          filter: { id: { _in: patientIds } },
          fields: ["id", "nombre", "telefono"],
          limit: -1,
        }),
      );
      patientsById.value = Object.fromEntries(patients.map((p) => [p.id, p]));
    } else {
      patientsById.value = {};
    }
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudieron cargar las citas.");
  } finally {
    if (!opts.silent) loading.value = false;
    loadInFlight = false;
  }
}

/**
 * Citas creadas desde /agendar (público) o por el bot de WhatsApp llegan a
 * Directus por fuera del panel, así que no hay evento local que las anuncie:
 * se refrescan solas por polling silencioso. Pausado mientras el modal está
 * abierto para no pisar una edición en curso.
 */
const POLL_INTERVAL_MS = 15_000;
let pollTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  await catalog.load();

  // Un médico no ve la opción "todos": se preselecciona a sí mismo (único
  // que `catalog.doctors` le devuelve). Recepción sí puede dejarlo en blanco.
  if (!auth.isReceptionist && !doctorFilter.value && catalog.doctors.length > 0) {
    doctorFilter.value = catalog.doctors[0]!.id;
  } else {
    await load();
  }

  pollTimer = setInterval(() => {
    if (!showModal.value) void load({ silent: true });
  }, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

watch([dateFilter, doctorFilter, estadoFilter], () => {
  currentPage.value = 1;
  load();
});

function openEdit(appointment: AppointmentRow): void {
  editingAppointment.value = appointment;
  showModal.value = true;
}

async function handleSaved(): Promise<void> {
  showModal.value = false;
  await load({ silent: true });
}

async function quickCancel(appointment: AppointmentRow): Promise<void> {
  const ok = await confirm({
    title: "Cancelar esta cita",
    message: "La cita quedará marcada como cancelada. Esta acción no se puede deshacer.",
    confirmLabel: "Cancelar cita",
  });
  if (!ok) return;
  try {
    await directus.request(updateItem("appointments", appointment.id, { estado: "cancelada" }));
    await load({ silent: true });
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo cancelar la cita.");
  }
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 class="font-display text-xl font-bold text-brand-800">Citas agendadas</h1>
    </div>

    <div class="mb-4 flex flex-wrap gap-3">
      <input
        v-model="dateFilter"
        type="date"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      />
      <select
        v-model="doctorFilter"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      >
        <option v-if="auth.isReceptionist" value="">Todos los médicos</option>
        <option v-for="d in catalog.doctors" :key="d.id" :value="d.id">{{ d.nombre }}</option>
      </select>
      <select
        v-model="estadoFilter"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      >
        <option value="">Todos los estados</option>
        <option v-for="(label, value) in ESTADO_LABELS" :key="value" :value="value">{{ label }}</option>
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
      <EmptyState v-if="sortedAppointments.length === 0" title="No hay citas para este filtro" />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[760px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50">
            <tr>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Hora</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Paciente</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Especialidad</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Servicio</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Médico</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</th>
              <th class="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="a in pagedAppointments" :key="a.id" class="transition hover:bg-slate-50">
              <td class="px-4 py-2.5 text-slate-700">{{ formatTime(new Date(a.inicio)) }}</td>
              <td class="px-4 py-2.5 text-slate-700">{{ patientLabel(a.patient) }}</td>
              <td class="px-4 py-2.5 text-slate-600">{{ especialidadName(a) }}</td>
              <td class="px-4 py-2.5 text-slate-600">{{ catalog.serviceName(a.service) }}</td>
              <td class="px-4 py-2.5 text-slate-600">{{ catalog.doctorName(a.doctor) }}</td>
              <td class="px-4 py-2.5">
                <Badge :tone="ESTADO_TONE[a.estado]">{{ ESTADO_LABELS[a.estado] }}</Badge>
              </td>
              <td class="px-4 py-2.5">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-brand-700"
                    title="Editar"
                    aria-label="Editar"
                    @click="openEdit(a)"
                  >
                    <span class="h-4 w-4"><ActionIcon name="edit" /></span>
                  </button>
                  <button
                    v-if="a.estado !== 'cancelada'"
                    type="button"
                    class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    title="Cancelar"
                    aria-label="Cancelar"
                    @click="quickCancel(a)"
                  >
                    <span class="h-4 w-4"><ActionIcon name="trash" /></span>
                  </button>
                  <a
                    v-if="a.estado === 'pendiente' && waLinks[a.id]"
                    :href="waLinks[a.id]!"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                    title="Enviar confirmación por WhatsApp"
                    aria-label="Enviar confirmación por WhatsApp"
                  >
                    <span class="h-4 w-4"><ActionIcon name="whatsapp" /></span>
                  </a>
                  <span
                    v-else-if="a.estado === 'pendiente'"
                    class="flex h-8 w-8 items-center justify-center rounded-md text-slate-200"
                    title="Teléfono incompleto o inválido"
                  >
                    <span class="h-4 w-4"><ActionIcon name="whatsapp" /></span>
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="sortedAppointments.length > PAGE_SIZE" class="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-2.5">
        <span class="text-xs text-slate-500">Página {{ currentPage }} de {{ totalPages }}</span>
        <div class="flex gap-2">
          <Button variant="secondary" size="sm" :disabled="currentPage === 1" @click="currentPage--">Anterior</Button>
          <Button variant="secondary" size="sm" :disabled="currentPage === totalPages" @click="currentPage++">Siguiente</Button>
        </div>
      </div>
    </div>

    <AppointmentFormModal
      v-if="showModal"
      mode="edit"
      :appointment="editingAppointment"
      @close="showModal = false"
      @saved="handleSaved"
    />
  </div>
</template>
