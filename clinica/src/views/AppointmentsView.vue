<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { readItems, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus } from "@/lib/directus";
import type { AppointmentRow, AppointmentStatus, PatientRow, TimeOffRow, WorkingHoursRow } from "@/lib/directus";
import { useAuthStore } from "@/stores/auth";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { CLINIC_TIMEZONE, formatDay, formatTime } from "@/lib/dateRanges";
import { buildConfirmationMessage, waMeLink } from "@/lib/messageTemplates";
import { dateRangeFilter } from "@/lib/queryHelpers";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { computeDaySlots } from "@/lib/schedule";
import { ESTADO_LABELS, ESTADO_TONE } from "@/lib/appointmentStatus";
import { useConfirm } from "@/composables/useConfirm";
import AppointmentFormModal from "@/components/AppointmentFormModal.vue";
import Card from "@/components/ui/Card.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";

/** Estados que ocupan la agenda (igual que BLOCKING_STATUSES del bot, src/repositories/appointments.ts). */
const BLOCKING_STATUSES: AppointmentStatus[] = ["pendiente", "confirmada", "completada"];

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

const showModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingAppointment = ref<AppointmentRow | undefined>(undefined);
const createInitialDoctorId = ref<string | undefined>(undefined);
const createInitialServiceId = ref<string | undefined>(undefined);
const createInitialDateTime = ref<Date | undefined>(undefined);

// --- Disponibilidad por médico del día (independiente de los filtros de la tabla) ---
const dayWorkingHours = ref<WorkingHoursRow[]>([]);
const dayTimeOff = ref<TimeOffRow[]>([]);
const dayActiveAppointments = ref<AppointmentRow[]>([]);
/** Servicio elegido solo para calcular "Horarios disponibles" (duración/buffer reales, igual que el modal). Sin elegir uno, se asume un hueco genérico de 30' sin buffer. */
const slotsServiceId = ref("");
/** Especialidad elegida para la tarjeta de horarios: acota qué médicos se listan y qué servicios ofrece el desplegable de al lado. */
const slotsSpecialtyId = ref("");

const sortedAppointments = computed(() =>
  [...appointments.value].sort((a, b) => a.inicio.localeCompare(b.inicio)),
);

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
        horaTexto: formatTime(inicio),
      }),
    );
  }
  return out;
});

/**
 * Un médico solo agenda en su propia especialidad: el desplegable no le ofrece
 * las demás de la clínica (la policy Doctor sí se las deja leer, hacen falta
 * para nombrar la especialidad de cada cita en la tabla). Recepción y admin,
 * que no tienen fila en `doctors`, ven todas.
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

/** Evita solapar una recarga (poll, guardado, filtro) con otra ya en curso. */
let loadInFlight = false;

/**
 * `silent`: evita tocar `loading` para que la tabla y la sección de "Horarios
 * disponibles" no desaparezcan mientras se refresca (usado tras crear/editar/
 * cancelar una cita, y en el polling en segundo plano, para que el cambio se
 * vea al instante sin sensación de recarga de pantalla). La carga inicial y
 * los cambios de filtro sí usan el loading normal.
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

    await loadAvailability();
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

  // Va antes del preseleccionado de `doctorFilter`, porque ese branch dispara
  // `load()` por el watcher y no conviene depender del orden. La especialidad
  // solo alimenta computeds, así que no necesita recargar nada.
  if (!slotsSpecialtyId.value) slotsSpecialtyId.value = slotsSpecialties.value[0]?.id ?? "";

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

watch([dateFilter, doctorFilter, estadoFilter], () => load());

// El servicio elegido pertenece a la especialidad anterior: vuelve a la duración genérica.
watch(slotsSpecialtyId, () => {
  slotsServiceId.value = "";
});

/** Abre el modal de nueva cita precargado desde un hueco libre de la sección de disponibilidad (mismo servicio, si se eligió uno, para que la hora siga siendo válida). */
function openCreateAt(doctorId: string, time: string): void {
  const day = DateTime.fromFormat(dateFilter.value, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
  const [h, m] = time.split(":").map(Number);
  modalMode.value = "create";
  editingAppointment.value = undefined;
  createInitialDoctorId.value = doctorId;
  createInitialServiceId.value = slotsServiceId.value || undefined;
  createInitialDateTime.value = day.set({ hour: h, minute: m, second: 0, millisecond: 0 }).toJSDate();
  showModal.value = true;
}

function openEdit(appointment: AppointmentRow): void {
  modalMode.value = "edit";
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
      <h1 class="font-display text-xl font-bold text-brand-800">Citas</h1>
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
            <tr v-for="a in sortedAppointments" :key="a.id" class="transition hover:bg-slate-50">
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
    </div>

    <Card v-if="!loading" class="mt-6">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-display text-sm font-bold text-brand-800">Horarios disponibles ({{ dateFilter }})</h2>
        <div class="flex flex-wrap items-center gap-2">
          <label class="text-xs font-medium text-slate-600">Especialidad</label>
          <select
            v-model="slotsSpecialtyId"
            class="rounded-lg border border-slate-300 px-2 py-1 text-xs transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option v-for="sp in slotsSpecialties" :key="sp.id" :value="sp.id">{{ sp.nombre }}</option>
          </select>
          <label class="text-xs font-medium text-slate-600">Servicio</label>
          <select
            v-model="slotsServiceId"
            class="rounded-lg border border-slate-300 px-2 py-1 text-xs transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">Duración genérica (30 min)</option>
            <option v-for="s in slotsServices" :key="s.id" :value="s.id">
              {{ s.nombre }} ({{ s.duracion_min }} min)
            </option>
          </select>
        </div>
      </div>
      <p class="mb-3 text-xs text-slate-500">
        Elige el servicio real para que las horas mostradas coincidan exactamente con las que ofrece el modal de "Nueva cita".
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
      :mode="modalMode"
      :appointment="editingAppointment"
      :initial-doctor-id="createInitialDoctorId"
      :initial-service-id="createInitialServiceId"
      :initial-date-time="createInitialDateTime"
      @close="showModal = false"
      @saved="handleSaved"
    />
  </div>
</template>
