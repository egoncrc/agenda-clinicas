<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { createItem, readItems, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus } from "@/lib/directus";
import type { AppointmentRow, AppointmentStatus, CancelledBy, PatientRow, TimeOffRow, WorkingHoursRow } from "@/lib/directus";
import { useAuthStore } from "@/stores/auth";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { CLINIC_TIMEZONE, toIsoOrThrow } from "@/lib/dateRanges";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { computeAvailableStartTimes, computeUnavailableDates } from "@/lib/schedule";
import DatePicker from "@/components/DatePicker.vue";
import Button from "@/components/ui/Button.vue";

/** Estados que ocupan la agenda (igual que BLOCKING_STATUSES del bot, src/repositories/appointments.ts). */
const BLOCKING_STATUSES: AppointmentStatus[] = ["pendiente", "confirmada", "completada"];
const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

const props = defineProps<{
  mode: "create" | "edit";
  appointment?: AppointmentRow;
  /** Para precargar desde un hueco libre de "Horarios disponibles" en Citas: doctora, servicio y horario ya elegidos. */
  initialDoctorId?: string;
  initialServiceId?: string;
  initialDateTime?: Date;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const auth = useAuthStore();
const catalog = useCatalogStore();
const clinica = useClinicaStore();

const ESTADOS: { value: AppointmentStatus; label: string }[] = [
  { value: "pendiente", label: "Pendiente" },
  { value: "confirmada", label: "Confirmada" },
  { value: "cancelada", label: "Cancelada" },
  { value: "completada", label: "Completada" },
  { value: "no_show", label: "No se presentó" },
];

// --- Paciente (solo se busca/crea en modo creación) ---
const patientQuery = ref("");
const searchResults = ref<PatientRow[]>([]);
const selectedPatient = ref<PatientRow | null>(null);
const newPatientName = ref("");
const newPatientPhone = ref("");
const searching = ref(false);
const existingPatientLabel = ref<string | null>(null);

// --- Cita ---
// En modo edición se precargan de una vez (sin esperar a onMounted) para que
// el watch de doctorId con `immediate: true` y el primer render ya vean los
// valores reales, en vez de mostrar de entrada "elige servicio/médico/fecha"
// y saltar recién después a los datos correctos.
const editingAppointment = props.mode === "edit" ? props.appointment : undefined;
// La especialidad acota servicios y médicos. Se deriva del médico/servicio ya
// elegidos (edición o precarga) una vez que el catálogo cargó (ver onMounted).
const specialtyId = ref("");
const serviceId = ref(editingAppointment?.service ?? props.initialServiceId ?? "");
const doctorId = ref(editingAppointment?.doctor ?? props.initialDoctorId ?? "");

/** Servicios y médicos de la especialidad elegida (o todos si aún no se eligió). */
const filteredServices = computed(() => catalog.servicesBySpecialty(specialtyId.value || undefined));
const filteredDoctors = computed(() => catalog.doctorsBySpecialty(specialtyId.value || undefined));

// Al cambiar de especialidad, suelta el servicio/médico que ya no pertenezcan a
// ella. No dispara al derivarla del propio servicio/médico elegido (ahí sí
// pertenecen), solo cuando el usuario cambia a otra especialidad distinta.
watch(specialtyId, () => {
  const sp = specialtyId.value;
  if (!sp) return;
  if (serviceId.value && catalog.services.find((s) => s.id === serviceId.value)?.specialty !== sp) {
    serviceId.value = "";
  }
  if (doctorId.value && catalog.doctors.find((d) => d.id === doctorId.value)?.specialty !== sp) {
    doctorId.value = "";
  }
});
const date = ref(editingAppointment ? toDateInput(new Date(editingAppointment.inicio)) : "");
const time = ref(editingAppointment ? toTimeInput(new Date(editingAppointment.inicio)) : "");
const estado = ref<AppointmentStatus>(editingAppointment?.estado ?? "pendiente");
/** Solo se muestra (y se envía) cuando el estado pasa a `cancelada`. */
const motivoCancelacion = ref<string>(editingAppointment?.motivo_cancelacion ?? "");

/**
 * Quién origina la cancelación, para el reporte. Se resuelve por el rol de quien
 * está usando el panel: si cancela desde acá, no es el paciente por WhatsApp.
 */
function quienCancela(): CancelledBy {
  if (auth.isAdmin) return "admin";
  if (auth.isReceptionist) return "recepcion";
  return "medico";
}

const saving = ref(false);
const error = ref<string | null>(null);

/** Hoy (zona de la clínica): no se pueden agendar citas en fechas pasadas. */
const todayStr = DateTime.now().setZone(CLINIC_TIMEZONE).toFormat("yyyy-LL-dd");

/** Horario laboral, ausencias y citas activas del médico elegido; alimentan tanto el calendario como las horas disponibles. Sin médico elegido, todo queda vacío. */
const doctorWorkingHours = ref<WorkingHoursRow[]>([]);
const doctorTimeOff = ref<TimeOffRow[]>([]);
const doctorAppointments = ref<AppointmentRow[]>([]);
const loadingSlots = ref(false);

const disabledWeekdays = computed(() => {
  // Mientras se carga el horario del médico elegido, doctorWorkingHours
  // todavía está vacío (no porque no atienda ningún día) — de tratarlo como
  // "no atiende nada" se deshabilitaría todo el calendario y se mostraría el
  // aviso de fecha inválida más abajo por un instante, hasta que llega la
  // respuesta real.
  if (loadingSlots.value) return [];
  const workingWeekdays = new Set<number>(doctorWorkingHours.value.map((wh) => wh.dia_semana));
  return workingWeekdays.size === 0 ? ALL_WEEKDAYS : ALL_WEEKDAYS.filter((wd) => !workingWeekdays.has(wd));
});

watch(
  doctorId,
  async (id) => {
    if (!id) {
      doctorWorkingHours.value = [];
      doctorTimeOff.value = [];
      doctorAppointments.value = [];
      return;
    }
    loadingSlots.value = true;
    try {
      const clinicId = clinica.activeClinicId ?? undefined;
      const [wh, timeOff, appointments] = await Promise.all([
        // Horario y ausencias son de esta clínica: el médico puede atender otros
        // días, o estar ausente solo, en otra sede.
        directus.request(
          readItems("working_hours", { filter: { doctor: { _eq: id }, clinic: { _eq: clinicId } }, limit: -1 }),
        ),
        directus.request(
          readItems("time_off", { filter: { doctor: { _eq: id }, clinic: { _eq: clinicId } }, limit: -1 }),
        ),
        // Las citas NO se acotan por clínica a propósito: el médico no puede
        // estar en dos sedes a la vez. Los permisos igual solo dejan ver las de
        // la clínica propia, así que un hueco ofrecido acá puede terminar
        // rechazado por el guard de Directus con 403 "se solapa".
        directus.request(
          readItems("appointments", {
            filter: { doctor: { _eq: id }, estado: { _in: BLOCKING_STATUSES } },
            limit: -1,
          }),
        ),
      ]);
      doctorWorkingHours.value = wh;
      doctorTimeOff.value = timeOff;
      doctorAppointments.value = appointments;
    } finally {
      loadingSlots.value = false;
    }
  },
  { immediate: true },
);

const bufferMin = computed(() => catalog.services.find((s) => s.id === serviceId.value)?.buffer_min ?? 0);

/** Citas activas del médico, sin contar la propia cita en edición (no debe bloquearse a sí misma). */
const appointmentsForCheck = computed(() =>
  doctorAppointments.value.filter((a) => !(props.mode === "edit" && props.appointment && a.id === props.appointment.id)),
);

/** Horas de inicio realmente disponibles (duración + buffer del servicio, horario laboral, ausencias y citas ya agendadas). */
const availableTimes = computed<string[]>(() => {
  if (!doctorId.value || !serviceId.value || !date.value) return [];
  return computeAvailableStartTimes({
    dateStr: date.value,
    workingHours: doctorWorkingHours.value,
    timeOff: doctorTimeOff.value,
    appointments: appointmentsForCheck.value,
    durationMin: durationMin.value,
    bufferMin: bufferMin.value,
    // El modal ofrece horas cada 30' (más cómodo para elegir a mano) aunque el paso
    // "real" del bot (SLOT_STEP_MINUTES) sea cada 15'.
    stepMinutes: 30,
  });
});

/** Rango de fechas ("yyyy-LL-dd") que el DatePicker tiene visible ahora mismo (mes actual + relleno). */
const visibleRange = ref<{ from: string; to: string } | null>(null);

/**
 * Días del rango visible sin ningún hueco para el médico+servicio elegidos
 * (agenda llena, o cubiertos por una ausencia puntual). Se calcula solo con
 * servicio ya elegido: sin él no se conoce la duración real a verificar, y el
 * calendario se comporta como antes (solo por día de semana). Recalcula al
 * navegar de mes en el DatePicker, sin ninguna consulta nueva a Directus — los
 * datos del médico ya están cargados completos en memoria.
 */
const unavailableDates = computed<string[]>(() => {
  if (!visibleRange.value || !doctorId.value || !serviceId.value) return [];
  return computeUnavailableDates(visibleRange.value, doctorWorkingHours.value, doctorTimeOff.value, appointmentsForCheck.value, {
    durationMin: durationMin.value,
    bufferMin: bufferMin.value,
    stepMinutes: 30,
  });
});

/** Incluye siempre la hora ya elegida (ej. al editar, o precargada desde "Horarios disponibles"), aunque ya no aparezca como libre — el backend valida de nuevo antes de guardar. */
const timeOptions = computed<string[]>(() => {
  if (time.value && !availableTimes.value.includes(time.value)) {
    return [time.value, ...availableTimes.value].sort();
  }
  return availableTimes.value;
});

function toDateInput(d: Date): string {
  return DateTime.fromJSDate(d, { zone: CLINIC_TIMEZONE }).toFormat("yyyy-LL-dd");
}
function toTimeInput(d: Date): string {
  return DateTime.fromJSDate(d, { zone: CLINIC_TIMEZONE }).toFormat("HH:mm");
}

onMounted(async () => {
  await catalog.load();

  // Deriva la especialidad del médico/servicio ya elegido (edición o precarga),
  // para que los selectores filtrados incluyan la selección actual. Si no hay
  // nada elegido y solo existe una especialidad, se elige sola.
  if (!specialtyId.value) {
    const currentDoctor = catalog.doctors.find((d) => d.id === doctorId.value);
    const currentService = catalog.services.find((s) => s.id === serviceId.value);
    specialtyId.value =
      currentDoctor?.specialty ??
      currentService?.specialty ??
      (catalog.specialties.length === 1 ? catalog.specialties[0].id : "");
  }

  if (props.mode === "edit" && props.appointment) {
    const patient = await directus.request(
      readItems("patients", { filter: { id: { _eq: props.appointment.patient } }, limit: 1 }),
    );
    existingPatientLabel.value = patient[0] ? `${patient[0].nombre?.trim() || "(sin nombre)"} — ${patient[0].telefono}` : null;
  } else if (props.initialDateTime) {
    date.value = toDateInput(props.initialDateTime);
    time.value = toTimeInput(props.initialDateTime);
  }
});

/**
 * Busca por nombre o teléfono: un mismo número puede tener varios pacientes
 * (ej. un hijo bajo el teléfono del padre), así que el nombre es lo que permite
 * distinguirlos; el teléfono sigue disponible para hallar a quien aún no tiene nombre.
 */
async function searchPatient(): Promise<void> {
  const query = patientQuery.value.trim();
  if (!query) return;
  searching.value = true;
  selectedPatient.value = null;
  try {
    const results = await directus.request(
      readItems("patients", {
        filter: {
          clinic: { _eq: clinica.activeClinicId ?? undefined },
          // Un paciente dado de baja no se puede volver a agendar (`_neq: false`
          // y no `_eq: true`: una ficha vieja puede tener `activo` en NULL).
          activo: { _neq: false },
          _or: [{ nombre: { _icontains: query } }, { telefono: { _contains: query } }],
        },
        limit: 10,
      }),
    );

    if (results.length === 1) {
      // Un solo resultado: se selecciona directo, sin exigir un clic extra.
      pickPatient(results[0]);
    } else {
      searchResults.value = results;
      // Precarga el nombre con lo buscado, listo para crear un paciente nuevo.
      if (results.length === 0) {
        newPatientName.value = query;
      }
    }
  } finally {
    searching.value = false;
  }
}

function pickPatient(p: PatientRow): void {
  selectedPatient.value = p;
  newPatientName.value = p.nombre?.trim() ?? "";
  searchResults.value = [];
}

/**
 * Escape hatch para el caso "encontré a la mamá pero la cita es para el hijo":
 * cambiar el nombre de un paciente ya seleccionado lo renombraría a él, en vez
 * de crear a otra persona. Esto suelta la selección y pasa al flujo de "crear
 * paciente nuevo", con el teléfono ya precargado para quedar bajo el mismo número.
 */
function addAnotherPersonSamePhone(): void {
  if (!selectedPatient.value) return;
  newPatientPhone.value = selectedPatient.value.telefono;
  newPatientName.value = "";
  selectedPatient.value = null;
  searchResults.value = [];
}

const durationMin = computed(
  () => catalog.services.find((s) => s.id === serviceId.value)?.duracion_min ?? 0,
);

/**
 * Por si la fecha elegida deja de aplicar después de elegirse: cambió el
 * médico y ya no atiende ese día de semana, o cambió el servicio a uno de
 * más duración y ese día deja de alcanzar.
 */
const dateProblem = computed<"weekday" | "full" | null>(() => {
  if (!date.value) return null;
  const weekday = DateTime.fromFormat(date.value, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE }).weekday;
  if (disabledWeekdays.value.includes(weekday)) return "weekday";
  if (unavailableDates.value.includes(date.value)) return "full";
  return null;
});

const canSubmit = computed(() => {
  if (!specialtyId.value || !serviceId.value || !doctorId.value || !date.value || !time.value) return false;
  if (dateProblem.value !== null) return false;
  if (props.mode === "create" && !selectedPatient.value) {
    if (!newPatientName.value.trim() || !newPatientPhone.value.trim()) return false;
  }
  return true;
});

/**
 * Devuelve el id del paciente a usar en la cita. Si es un paciente existente
 * (ej. autocreado por el bot de WhatsApp solo con el teléfono, sin nombre)
 * y el nombre cambió en el formulario, lo actualiza de una vez.
 */
async function ensurePatientId(): Promise<string> {
  const nombre = newPatientName.value.trim() || null;

  if (selectedPatient.value) {
    if (nombre !== (selectedPatient.value.nombre?.trim() || null)) {
      await directus.request(updateItem("patients", selectedPatient.value.id, { nombre }));
    }
    return selectedPatient.value.id;
  }

  // Un teléfono puede tener varios pacientes: el primero es el titular (dueño del
  // número); los siguientes (ej. un hijo bajo el número del padre) son familiares.
  const telefono = newPatientPhone.value.trim();
  const yaExisten = await directus.request(
    readItems("patients", {
      filter: { telefono: { _eq: telefono }, clinic: { _eq: clinica.activeClinicId ?? undefined } },
      limit: 1,
      fields: ["id"],
    }),
  );
  const created = await directus.request(
    createItem("patients", {
      telefono,
      nombre,
      titular: yaExisten.length === 0,
      clinic: clinica.activeClinicId ?? undefined,
    }),
  );
  return created.id;
}

async function handleSubmit(): Promise<void> {
  error.value = null;
  saving.value = true;
  try {
    const inicio = DateTime.fromFormat(`${date.value} ${time.value}`, "yyyy-LL-dd HH:mm", {
      zone: CLINIC_TIMEZONE,
    });
    const fin = inicio.plus({ minutes: durationMin.value });

    if (props.mode === "create") {
      const patientId = await ensurePatientId();
      await directus.request(
        createItem("appointments", {
          clinic: clinica.activeClinicId ?? undefined,
          doctor: doctorId.value,
          patient: patientId,
          service: serviceId.value,
          inicio: toIsoOrThrow(inicio),
          fin: toIsoOrThrow(fin),
          estado: "pendiente",
          origen: "panel",
        }),
      );
    } else if (props.appointment) {
      await directus.request(
        updateItem("appointments", props.appointment.id, {
          doctor: doctorId.value,
          service: serviceId.value,
          inicio: toIsoOrThrow(inicio),
          fin: toIsoOrThrow(fin),
          estado: estado.value,
          // Solo al cancelar: incluir estos campos siempre borraría el motivo de una
          // cita que se reactiva, y reestampar la hora en cada guardado posterior
          // arruinaría la anticipación del reporte de Cancelaciones.
          //
          // Redundante con `appointment-cancel-stamp-hook` y a propósito, mismo
          // criterio que la cascada de TimeOffFormModal: el panel no depende de que
          // esa extensión esté desplegada. Lo explícito gana sobre la derivación del
          // hook, y desde acá se sabe con certeza quién canceló.
          ...(estado.value === "cancelada" && props.appointment.estado !== "cancelada"
            ? {
                cancelado_en: new Date().toISOString(),
                cancelado_por: quienCancela(),
                motivo_cancelacion: motivoCancelacion.value.trim() || null,
              }
            : estado.value === "cancelada"
              ? { motivo_cancelacion: motivoCancelacion.value.trim() || null }
              : {}),
        }),
      );
    }
    emit("saved");
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo guardar la cita.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="max-h-full w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-4 text-lg font-bold text-brand-800">
        {{ mode === "create" ? "Nueva cita" : "Editar cita" }}
      </h2>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div v-if="mode === 'create'">
          <label class="mb-1 block text-sm font-medium text-slate-700">Paciente (buscar por nombre o teléfono)</label>
          <div class="flex gap-2">
            <input
              v-model="patientQuery"
              type="text"
              placeholder="Nombre o +506..."
              class="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              @input="selectedPatient = null; newPatientName = ''; newPatientPhone = ''"
            />
            <Button variant="secondary" @click="searchPatient">Buscar</Button>
          </div>

          <ul v-if="searchResults.length > 0" class="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
            <li
              v-for="p in searchResults"
              :key="p.id"
              class="cursor-pointer px-3 py-2 text-sm hover:bg-slate-50"
              @click="pickPatient(p)"
            >
              {{ p.nombre?.trim() || "(sin nombre)" }} — {{ p.telefono }}
            </li>
          </ul>

          <div v-if="selectedPatient" class="mt-2 flex items-center justify-between gap-2">
            <p class="text-sm text-brand-700">
              Paciente: {{ selectedPatient.nombre?.trim() || "(sin nombre)" }} — {{ selectedPatient.telefono }}
            </p>
            <button
              type="button"
              class="whitespace-nowrap text-xs font-medium text-brand-700 hover:underline"
              @click="addAnotherPersonSamePhone"
            >
              ¿Es para otra persona?
            </button>
          </div>
          <p v-else-if="patientQuery && searchResults.length === 0 && !searching" class="mt-2 text-sm text-slate-500">
            No se encontró; se creará un paciente nuevo.
          </p>

          <div v-if="selectedPatient" class="mt-2">
            <label class="mb-1 block text-sm font-medium text-slate-700">Nombre del paciente</label>
            <input
              v-model="newPatientName"
              type="text"
              placeholder="Nombre del paciente"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>

          <div v-else-if="patientQuery && searchResults.length === 0 && !searching" class="mt-2 space-y-2">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Nombre del paciente</label>
              <input
                v-model="newPatientName"
                type="text"
                placeholder="Nombre del paciente"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
              <input
                v-model="newPatientPhone"
                type="text"
                placeholder="+506..."
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-slate-600">Paciente: {{ existingPatientLabel ?? "…" }}</p>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Especialidad</label>
          <select v-model="specialtyId" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30">
            <option value="" disabled>Selecciona una especialidad</option>
            <option v-for="sp in catalog.specialties" :key="sp.id" :value="sp.id">{{ sp.nombre }}</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Servicio</label>
          <p v-if="!specialtyId" class="mb-1 text-xs text-slate-500">Elige una especialidad para ver sus servicios.</p>
          <select v-model="serviceId" :disabled="!specialtyId" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-100">
            <option value="" disabled>Selecciona un servicio</option>
            <option v-for="s in filteredServices" :key="s.id" :value="s.id">
              {{ s.nombre }} ({{ s.duracion_min }} min)
            </option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Médico</label>
          <p v-if="!specialtyId" class="mb-1 text-xs text-slate-500">Elige una especialidad para ver sus médicos.</p>
          <select v-model="doctorId" :disabled="!specialtyId" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-100">
            <option value="" disabled>Selecciona un médico</option>
            <option v-for="d in filteredDoctors" :key="d.id" :value="d.id">{{ d.nombre }}</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Fecha</label>
          <p v-if="!doctorId" class="mb-1 text-xs text-slate-500">Elige un médico para ver sus días disponibles.</p>
          <DatePicker
            v-model="date"
            :disabled-weekdays="disabledWeekdays"
            :min-date="todayStr"
            :disabled-dates="unavailableDates"
            @visible-range-change="visibleRange = $event"
          />
          <p v-if="dateProblem === 'weekday'" class="mt-1 text-xs text-red-600">
            Este médico no atiende ese día; elige otra fecha.
          </p>
          <p v-else-if="dateProblem === 'full'" class="mt-1 text-xs text-red-600">
            Ese día ya no tiene cupos disponibles para este médico y servicio; elige otra fecha.
          </p>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Hora</label>
          <p v-if="!serviceId || !doctorId || !date" class="text-xs text-slate-500">
            Elige servicio, médico y fecha para ver las horas disponibles.
          </p>
          <p v-else-if="loadingSlots" class="text-xs text-slate-500">Cargando horarios disponibles…</p>
          <template v-else>
            <select v-model="time" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30">
              <option value="" disabled>Selecciona una hora</option>
              <option v-for="t in timeOptions" :key="t" :value="t">{{ t }}</option>
            </select>
            <p v-if="timeOptions.length === 0" class="mt-1 text-xs text-red-600">
              No hay horas disponibles ese día para este médico y servicio.
            </p>
          </template>
        </div>

        <div v-if="mode === 'edit'">
          <label class="mb-1 block text-sm font-medium text-slate-700">Estado</label>
          <select v-model="estado" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30">
            <option v-for="e in ESTADOS" :key="e.value" :value="e.value">{{ e.label }}</option>
          </select>
        </div>

        <!-- Solo al cancelar. Opcional: obligar un motivo haría que la recepción
             escriba cualquier cosa para poder guardar, y el reporte se llenaría
             de ruido en vez de quedarse honestamente vacío. -->
        <div v-if="mode === 'edit' && estado === 'cancelada'">
          <label class="mb-1 block text-sm font-medium text-slate-700">
            Motivo de la cancelación <span class="font-normal text-slate-400">(opcional)</span>
          </label>
          <input
            v-model="motivoCancelacion"
            type="text"
            maxlength="200"
            placeholder="Ej: el paciente reagenda, enfermedad, viaje…"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <p class="mt-1 text-xs text-slate-500">Aparece en el reporte de Cancelaciones.</p>
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="secondary" @click="emit('close')">Cancelar</Button>
          <Button type="submit" :disabled="!canSubmit" :loading="saving">
            {{ saving ? "Guardando…" : "Guardar" }}
          </Button>
        </div>
      </form>
    </div>
  </div>
</template>
