<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { readItems } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus } from "@/lib/directus";
import type { AppointmentRow, AppointmentStatus, TimeOffRow, WorkingHoursRow } from "@/lib/directus";
import { useAuthStore } from "@/stores/auth";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";
import { dateRangeFilter } from "@/lib/queryHelpers";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { computeDaySlots } from "@/lib/schedule";
import AppointmentFormModal from "@/components/AppointmentFormModal.vue";
import Card from "@/components/ui/Card.vue";
import EmptyState from "@/components/ui/EmptyState.vue";

/** Estados que ocupan la agenda (igual que BLOCKING_STATUSES del bot, src/repositories/appointments.ts). */
const BLOCKING_STATUSES: AppointmentStatus[] = ["pendiente", "confirmada", "completada"];

const auth = useAuthStore();
const catalog = useCatalogStore();
const clinica = useClinicaStore();

/**
 * Fecha propia de esta pantalla: la tabla de /citas tiene la suya. Compartirlas
 * (como cuando ambas tarjetas vivían en la misma vista) confundía, porque los
 * demás filtros de cada pantalla solo aplican a la mitad de lo que se veía.
 */
const dateFilter = ref(DateTime.now().setZone(CLINIC_TIMEZONE).toFormat("yyyy-LL-dd"));

const loading = ref(true);
const error = ref<string | null>(null);

const dayWorkingHours = ref<WorkingHoursRow[]>([]);
const dayTimeOff = ref<TimeOffRow[]>([]);
const dayActiveAppointments = ref<AppointmentRow[]>([]);
/**
 * Servicio con el que se calculan los "Horarios disponibles" (duración/buffer
 * reales) y con el que se agenda al tocar un hueco: el modal ya no lo vuelve a
 * preguntar. Siempre hay uno elegido, salvo que la especialidad no tenga
 * ninguno configurado; ahí se cae a un hueco genérico de 30' sin buffer.
 */
const slotsServiceId = ref("");
/** Especialidad elegida: acota qué médicos se listan y qué servicios ofrece el desplegable de al lado. */
const slotsSpecialtyId = ref("");

const showModal = ref(false);
const createInitialDoctorId = ref<string | undefined>(undefined);
const createInitialServiceId = ref<string | undefined>(undefined);
const createInitialDateTime = ref<Date | undefined>(undefined);

/**
 * Un médico solo agenda en su propia especialidad: el desplegable no le ofrece
 * las demás de la clínica. Recepción y admin, que no tienen fila en `doctors`,
 * ven todas. (Esta pantalla es hoy solo de recepción/admin — ver `blockDoctor`
 * en el router —, pero la regla se conserva por si vuelve a abrirse al médico.)
 */
const slotsSpecialties = computed(() => {
  const own = catalog.doctors.find((d) => d.id === auth.ownDoctorId)?.specialty;
  if (!own) return catalog.specialties;
  return catalog.specialties.filter((sp) => sp.id === own);
});

/** Ambos caen a la lista completa si no hay especialidad elegida (clínica sin especialidades cargadas). */
const slotsDoctors = computed(() => catalog.doctorsBySpecialty(slotsSpecialtyId.value || undefined));
const slotsServices = computed(() => catalog.servicesBySpecialty(slotsSpecialtyId.value || undefined));

const slotsByDoctor = computed(() => {
  const service = catalog.services.find((s) => s.id === slotsServiceId.value);
  const map: Record<string, ReturnType<typeof computeDaySlots>> = {};
  for (const d of slotsDoctors.value) {
    map[d.id] = computeDaySlots(
      dateFilter.value,
      dayWorkingHours.value.filter((wh) => wh.doctor === d.id),
      dayTimeOff.value.filter((t) => t.doctor === d.id),
      dayActiveAppointments.value.filter((a) => a.doctor === d.id),
      service ? { durationMin: service.duracion_min, bufferMin: service.buffer_min } : {},
    );
  }
  return map;
});

async function loadAvailability(): Promise<void> {
  if (catalog.doctors.length === 0) return;
  const doctorIds = catalog.doctors.map((d) => d.id);
  const day = DateTime.fromFormat(dateFilter.value, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });

  const clinicId = clinica.activeClinicId ?? undefined;

  const [wh, to, appts] = await Promise.all([
    // Horario y ausencias son por clínica: el mismo médico atiende otros días
    // (y puede estar ausente solo) en otra sede.
    directus.request(
      readItems("working_hours", { filter: { doctor: { _in: doctorIds }, clinic: { _eq: clinicId } }, limit: -1 }),
    ),
    directus.request(
      readItems("time_off", { filter: { doctor: { _in: doctorIds }, clinic: { _eq: clinicId } }, limit: -1 }),
    ),
    // Las citas NO se filtran por clínica: el médico no puede estar en dos sedes
    // a la vez, así que una cita suya en otra clínica también ocupa el hueco.
    // Ojo: los permisos solo dejan leer las de la clínica propia, así que este
    // cálculo puede ofrecer un hueco que el guard de Directus luego rechace
    // (403 "se solapa"). Es el precio de no exponer datos de otro tenant.
    directus.request(
      readItems("appointments", {
        filter: {
          doctor: { _in: doctorIds },
          estado: { _in: BLOCKING_STATUSES },
          inicio: dateRangeFilter(day.startOf("day").toISO()!, day.endOf("day").toISO()!),
        },
        limit: -1,
      }),
    ),
  ]);
  dayWorkingHours.value = wh;
  dayTimeOff.value = to;
  dayActiveAppointments.value = appts;
}

/** Evita solapar una recarga (poll, guardado, cambio de fecha) con otra ya en curso. */
let loadInFlight = false;

/**
 * `silent`: evita tocar `loading` para que los huecos no desaparezcan mientras
 * se refrescan (usado tras agendar y en el polling en segundo plano, para que
 * el cambio se vea al instante sin sensación de recarga de pantalla). La carga
 * inicial y los cambios de fecha sí usan el loading normal.
 */
async function load(opts: { silent?: boolean } = {}): Promise<void> {
  if (loadInFlight) return;
  loadInFlight = true;
  if (!opts.silent) loading.value = true;
  error.value = null;
  try {
    await catalog.load();
    await loadAvailability();
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudieron cargar los horarios disponibles.");
  } finally {
    if (!opts.silent) loading.value = false;
    loadInFlight = false;
  }
}

/**
 * Citas creadas desde /agendar (público), por el bot de WhatsApp o por otra
 * recepcionista llegan a Directus por fuera de esta pantalla: sin polling, se
 * ofrecería un hueco que ya está tomado. Pausado mientras el modal está abierto
 * para no pisar una carga en curso.
 */
const POLL_INTERVAL_MS = 15_000;
let pollTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  await catalog.load();

  if (!slotsSpecialtyId.value) slotsSpecialtyId.value = slotsSpecialties.value[0]?.id ?? "";
  if (!slotsServiceId.value) slotsServiceId.value = slotsServices.value[0]?.id ?? "";

  await load();

  pollTimer = setInterval(() => {
    if (!showModal.value) void load({ silent: true });
  }, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

watch(dateFilter, () => {
  load();
});

// El servicio elegido pertenece a la especialidad anterior: pasa al primero de la nueva.
watch(slotsSpecialtyId, () => {
  slotsServiceId.value = slotsServices.value[0]?.id ?? "";
});

/** Abre el modal de nueva cita precargado desde un hueco libre (mismo servicio, si se eligió uno, para que la hora siga siendo válida). */
function openCreateAt(doctorId: string, time: string): void {
  const day = DateTime.fromFormat(dateFilter.value, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
  const [h, m] = time.split(":").map(Number);
  createInitialDoctorId.value = doctorId;
  createInitialServiceId.value = slotsServiceId.value || undefined;
  createInitialDateTime.value = day.set({ hour: h, minute: m, second: 0, millisecond: 0 }).toJSDate();
  showModal.value = true;
}

async function handleSaved(): Promise<void> {
  showModal.value = false;
  slotsServiceId.value = slotsServices.value[0]?.id ?? "";
  await load({ silent: true });
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 class="font-display text-xl font-bold text-brand-800">Agendar cita</h1>
    </div>

    <div class="mb-4 flex flex-wrap gap-3">
      <input
        v-model="dateFilter"
        type="date"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      />
      <select
        v-model="slotsSpecialtyId"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      >
        <option v-for="sp in slotsSpecialties" :key="sp.id" :value="sp.id">{{ sp.nombre }}</option>
      </select>
      <select
        v-model="slotsServiceId"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      >
        <option v-if="slotsServices.length === 0" value="">Duración genérica (30 min)</option>
        <option v-for="s in slotsServices" :key="s.id" :value="s.id">
          {{ s.nombre }} ({{ s.duracion_min }} min)
        </option>
      </select>
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>
    <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>

    <Card v-else>
      <p class="mb-3 text-xs text-slate-500">
        Las horas se calculan con la duración real del servicio elegido, y ese es el servicio con el que se agenda al tocar un hueco.
      </p>
      <EmptyState v-if="slotsDoctors.length === 0" title="No hay médicos activos en esta especialidad" />
      <div v-else class="space-y-4">
        <div v-for="d in slotsDoctors" :key="d.id" class="rounded-lg border border-slate-200 p-4">
          <h3 class="mb-2 text-sm font-semibold text-slate-700">{{ d.nombre }}</h3>
          <p v-if="slotsByDoctor[d.id]?.length === 0" class="text-sm text-slate-500">
            Sin horario laboral configurado para este día.
          </p>
          <div v-else class="flex flex-wrap gap-1.5">
            <button
              v-for="slot in slotsByDoctor[d.id]"
              :key="slot.time"
              type="button"
              :disabled="!slot.free"
              class="rounded-md border px-2 py-1 text-xs font-medium transition"
              :class="
                slot.free
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              "
              @click="slot.free && openCreateAt(d.id, slot.time)"
            >
              {{ slot.time }}
            </button>
          </div>
        </div>
      </div>
    </Card>

    <AppointmentFormModal
      v-if="showModal"
      mode="create"
      :initial-doctor-id="createInitialDoctorId"
      :initial-service-id="createInitialServiceId"
      :initial-date-time="createInitialDateTime"
      @close="showModal = false"
      @saved="handleSaved"
    />
  </div>
</template>
