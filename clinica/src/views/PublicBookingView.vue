<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { DateTime } from "luxon";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";
import DatePicker from "@/components/DatePicker.vue";

const route = useRoute();
/** La clínica se identifica por el link que comparte cada una: .../agendar?clinica=<id>. */
const clinicaId = computed(() => (typeof route.query.clinica === "string" ? route.query.clinica : ""));

/** Horizonte de días hacia adelante en los que se verifica disponibilidad real. */
const BOOKING_HORIZON_DAYS = 60;

const BOOKING_API_URL = import.meta.env.VITE_BOOKING_API_URL as string;
/**
 * Token embebido en el build público (no en la URL): así el link que se
 * comparte es solo "https://panel.egonia.site/agendar", sin nada que se
 * pueda copiar mal o quedar en el historial del navegador. No es un secreto
 * real de cara al visitante (viaja en el bundle JS público, cualquiera con
 * herramientas de desarrollador puede verlo) — solo evita que el link "se
 * vea feo" o se comparta incompleto; el control de acceso real sigue siendo
 * la API del bot exigiéndolo en cada request.
 */
const BOOKING_PUBLIC_TOKEN = import.meta.env.VITE_BOOKING_PUBLIC_TOKEN as string;

interface SpecialtyOption {
  id: string;
  nombre: string;
}
interface DoctorOption {
  id: string;
  nombre: string;
  specialtyId: string;
}
interface ServiceOption {
  id: string;
  nombre: string;
  duracionMin: number;
  specialtyId: string;
}

function tokenParams(): Record<string, string> {
  return { token: BOOKING_PUBLIC_TOKEN, clinica: clinicaId.value };
}

// --- Carga inicial: valida el link y trae especialidades/médicos/servicios ---
const loadingContext = ref(true);
const contextError = ref<string | null>(null);
const clinicName = ref("");
const specialties = ref<SpecialtyOption[]>([]);
const doctors = ref<DoctorOption[]>([]);
const services = ref<ServiceOption[]>([]);

async function loadContext(): Promise<void> {
  loadingContext.value = true;
  contextError.value = null;
  if (!clinicaId.value) {
    contextError.value = "Este link no es válido: falta indicar la clínica.";
    loadingContext.value = false;
    return;
  }
  try {
    const params = new URLSearchParams(tokenParams());
    const res = await fetch(`${BOOKING_API_URL}/context?${params.toString()}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "No se pudo cargar la información.");

    clinicName.value = body.clinicName ?? "";
    specialties.value = body.specialties ?? [];
    doctors.value = body.doctors;
    services.value = body.services;
    // Una sola especialidad: se elige sola (el selector queda oculto).
    if (specialties.value.length === 1) specialtyId.value = specialties.value[0].id;
  } catch (e) {
    contextError.value = e instanceof Error ? e.message : "No se pudo cargar la información.";
  } finally {
    loadingContext.value = false;
  }
}

// --- Formulario ---
const telefono = ref("");
const nombre = ref("");
const specialtyId = ref("");
const doctorId = ref("");
const serviceId = ref("");
const date = ref("");
const time = ref("");

/** Servicios y médicos de la especialidad elegida. */
const filteredServices = computed(() =>
  specialtyId.value ? services.value.filter((s) => s.specialtyId === specialtyId.value) : [],
);
const filteredDoctors = computed(() =>
  specialtyId.value ? doctors.value.filter((d) => d.specialtyId === specialtyId.value) : [],
);

// Al cambiar de especialidad, resetea servicio y médico.
watch(specialtyId, () => {
  serviceId.value = "";
  doctorId.value = "";
});

const today = DateTime.now().setZone(CLINIC_TIMEZONE).startOf("day");
const todayIso = today.toFormat("yyyy-LL-dd");
const maxDateIso = today.plus({ days: BOOKING_HORIZON_DAYS }).toFormat("yyyy-LL-dd");

// --- Disponibilidad real (mismas reglas que el resto del sistema) para el horizonte completo ---
const loadingSlots = ref(false);
const slotsError = ref<string | null>(null);
const availableIsoTimes = ref<string[]>([]);

async function loadAvailability(): Promise<void> {
  if (!doctorId.value || !serviceId.value) {
    availableIsoTimes.value = [];
    return;
  }
  loadingSlots.value = true;
  slotsError.value = null;
  try {
    const params = new URLSearchParams({
      ...tokenParams(),
      doctorId: doctorId.value,
      serviceId: serviceId.value,
      from: todayIso,
      to: maxDateIso,
    });
    const res = await fetch(`${BOOKING_API_URL}/availability?${params.toString()}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "No se pudo cargar la disponibilidad.");
    availableIsoTimes.value = body.slots;
  } catch (e) {
    slotsError.value = e instanceof Error ? e.message : "No se pudo cargar la disponibilidad.";
  } finally {
    loadingSlots.value = false;
  }
}

watch([doctorId, serviceId], () => {
  date.value = "";
  time.value = "";
  void loadAvailability();
});

watch(date, () => {
  time.value = "";
});

/** Días (dentro del horizonte) sin ningún hueco real disponible para el médico+servicio elegidos. */
const disabledDates = computed<string[]>(() => {
  const withSlots = new Set(
    availableIsoTimes.value.map((iso) => DateTime.fromISO(iso, { zone: CLINIC_TIMEZONE }).toFormat("yyyy-LL-dd")),
  );
  const disabled: string[] = [];
  let cursor = today;
  const end = today.plus({ days: BOOKING_HORIZON_DAYS });
  while (cursor <= end) {
    const iso = cursor.toFormat("yyyy-LL-dd");
    if (!withSlots.has(iso)) disabled.push(iso);
    cursor = cursor.plus({ days: 1 });
  }
  return disabled;
});

/** Horas (HH:mm) disponibles para el día elegido. */
const timeOptions = computed<string[]>(() => {
  if (!date.value) return [];
  return availableIsoTimes.value
    .filter((iso) => DateTime.fromISO(iso, { zone: CLINIC_TIMEZONE }).toFormat("yyyy-LL-dd") === date.value)
    .map((iso) => DateTime.fromISO(iso, { zone: CLINIC_TIMEZONE }).toFormat("HH:mm"))
    .sort();
});

const selectedServiceLabel = computed(
  () => services.value.find((s) => s.id === serviceId.value)?.nombre ?? "",
);
const selectedDoctorLabel = computed(
  () => doctors.value.find((d) => d.id === doctorId.value)?.nombre ?? "",
);

// --- Envío ---
const saving = ref(false);
const saveError = ref<string | null>(null);
const confirmedInicio = ref<Date | null>(null);

/** Mismo criterio laxo tipo E.164 que valida el backend (ver src/publicBooking.ts). */
const PHONE_RE = /^\+?\d{7,15}$/;
const phoneValid = computed(() => PHONE_RE.test(telefono.value.trim()));

interface HouseholdPatient {
  id: string;
  nombre: string | null;
  titular: boolean;
}

/**
 * Personas ya registradas bajo el teléfono digitado (titular y familiares), y
 * la persona elegida entre ellas. Un mismo teléfono puede tener varias (ej. un
 * hijo bajo el número de un padre) — ver GET /household en src/publicBooking.ts.
 */
const household = ref<HouseholdPatient[]>([]);
/** Distingue "todavía no se buscó/está buscando" de "se buscó y esto es lo que hay", igual que en el panel. */
const householdChecked = ref(false);
const loadingHousehold = ref(false);
const selectedPatientId = ref<string | null>(null);
/** El teléfono ya tiene gente registrada, pero la cita es para alguien nuevo (ej. otro hijo). */
const addingNewPerson = ref(false);
let lookupTimer: ReturnType<typeof setTimeout> | undefined;

async function loadHousehold(telefonoTrim: string): Promise<void> {
  loadingHousehold.value = true;
  try {
    const params = new URLSearchParams({ ...tokenParams(), telefono: telefonoTrim });
    const res = await fetch(`${BOOKING_API_URL}/household?${params.toString()}`);
    household.value = res.ok ? ((await res.json()).patients ?? []) : [];
  } catch {
    // Falla silenciosa: en el peor caso se pide el nombre de nuevo, no bloquea el agendamiento.
    household.value = [];
  } finally {
    loadingHousehold.value = false;
    householdChecked.value = true;
  }
}

watch(telefono, (value) => {
  household.value = [];
  householdChecked.value = false;
  selectedPatientId.value = null;
  addingNewPerson.value = false;
  nombre.value = "";
  clearTimeout(lookupTimer);
  const telefonoTrim = value.trim();
  if (!PHONE_RE.test(telefonoTrim)) return;
  lookupTimer = setTimeout(() => void loadHousehold(telefonoTrim), 400);
});

const selectedPatient = computed(() => household.value.find((p) => p.id === selectedPatientId.value) ?? null);

function selectPatient(p: HouseholdPatient): void {
  selectedPatientId.value = p.id;
  addingNewPerson.value = false;
  nombre.value = p.nombre ?? "";
}

function startNewPerson(): void {
  selectedPatientId.value = null;
  addingNewPerson.value = true;
  nombre.value = "";
}

/**
 * Hace falta el nombre cuando: el teléfono no tiene a nadie todavía (la
 * primera persona registrada queda como titular), se está dando de alta a
 * alguien nuevo bajo un teléfono que ya tiene gente, o la persona elegida de
 * la lista existe pero aún no tiene nombre (ej. la creó el bot de WhatsApp
 * solo con el teléfono).
 */
const needsName = computed(() => {
  if (!householdChecked.value) return false;
  if (household.value.length === 0) return true;
  if (addingNewPerson.value) return true;
  if (selectedPatient.value) return !selectedPatient.value.nombre;
  return false;
});

/** Ya se identificó para quién es la cita: alguien de la lista, alguien nuevo, o (número sin nadie) el nombre propio. */
const patientResolved = computed(
  () => !!selectedPatientId.value || addingNewPerson.value || (householdChecked.value && household.value.length === 0),
);

const canSubmit = computed(
  () =>
    !!(
      phoneValid.value &&
      patientResolved.value &&
      (!needsName.value || nombre.value.trim()) &&
      specialtyId.value &&
      doctorId.value &&
      serviceId.value &&
      date.value &&
      time.value
    ),
);

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    const inicio = DateTime.fromFormat(`${date.value} ${time.value}`, "yyyy-LL-dd HH:mm", {
      zone: CLINIC_TIMEZONE,
    });
    const payload: Record<string, unknown> = {
      ...tokenParams(),
      telefono: telefono.value.trim(),
      doctorId: doctorId.value,
      serviceId: serviceId.value,
      inicio: inicio.toISO(),
    };
    if (selectedPatientId.value) {
      payload.patientId = selectedPatientId.value;
      if (needsName.value) payload.nombre = nombre.value.trim();
    } else if (addingNewPerson.value) {
      payload.pacienteNombre = nombre.value.trim();
    } else {
      payload.nombre = nombre.value.trim();
    }
    const res = await fetch(`${BOOKING_API_URL}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "No se pudo agendar la cita.");
    confirmedInicio.value = new Date(body.inicio);
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : "No se pudo agendar la cita.";
    // El hueco pudo dejar de estar disponible entre que se cargó y se envió; se refresca la lista.
    await loadAvailability();
  } finally {
    saving.value = false;
  }
}

const confirmedLabel = computed(() => {
  if (!confirmedInicio.value) return "";
  return DateTime.fromJSDate(confirmedInicio.value, { zone: CLINIC_TIMEZONE })
    .setLocale("es")
    .toFormat("cccc d 'de' LLLL, HH:mm");
});

onMounted(loadContext);
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
    <div class="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 class="font-display mb-1 text-2xl font-bold text-brand-800">{{ clinicName || "Agenda Médica" }}</h1>
      <p class="mb-6 text-sm text-slate-500">Agenda tu cita sin necesidad de cuenta.</p>

      <p v-if="loadingContext" class="text-sm text-slate-500">Cargando…</p>

      <p v-else-if="contextError" class="text-sm text-red-600">{{ contextError }}</p>

      <div v-else-if="confirmedInicio" class="space-y-3">
        <p class="text-sm font-medium text-emerald-700">¡Listo! Tu cita quedó agendada.</p>
        <p class="text-sm text-slate-700">
          {{ selectedServiceLabel }} con {{ selectedDoctorLabel }}<br />
          <span class="font-medium capitalize">{{ confirmedLabel }}</span>
        </p>
        <p class="text-xs text-slate-500">Te esperamos. Si necesitas cambiar el horario, escríbenos por WhatsApp.</p>
      </div>

      <form v-else class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
          <input
            v-model="telefono"
            type="tel"
            required
            placeholder="+506..."
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <p v-if="telefono && !phoneValid" class="mt-1 text-xs text-red-600">
            Ingresa un número de teléfono válido.
          </p>
          <p v-else-if="loadingHousehold" class="mt-1 text-xs text-slate-500">Buscando…</p>
        </div>

        <!-- Personas ya registradas bajo este teléfono (titular y familiares):
             se elige entre ellas en vez de volver a pedir el nombre de quien ya
             está en el sistema. Ver `loadHousehold` / GET /household. -->
        <div v-if="phoneValid && householdChecked && household.length > 0">
          <label class="mb-1 block text-sm font-medium text-slate-700">¿Para quién es la cita?</label>
          <ul class="divide-y divide-slate-100 rounded-md border border-slate-200">
            <li
              v-for="p in household"
              :key="p.id"
              class="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50"
              :class="selectedPatientId === p.id ? 'bg-brand-50 font-medium text-brand-700' : ''"
              @click="selectPatient(p)"
            >
              <span>{{ p.nombre || "(sin nombre)" }}</span>
              <span v-if="p.titular" class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Titular</span>
            </li>
            <li
              class="cursor-pointer px-3 py-2 text-sm font-medium text-brand-700 hover:bg-slate-50"
              :class="addingNewPerson ? 'bg-brand-50' : ''"
              @click="startNewPerson"
            >
              + Otra persona (ej. un hijo/a)
            </li>
          </ul>
        </div>

        <div v-if="needsName">
          <label class="mb-1 block text-sm font-medium text-slate-700">
            {{ addingNewPerson ? "Nombre de quien recibirá la cita" : "Nombre completo" }}
          </label>
          <input
            v-model="nombre"
            type="text"
            required
            placeholder="Nombre completo"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>

        <div v-if="specialties.length > 1">
          <label class="mb-1 block text-sm font-medium text-slate-700">Especialidad</label>
          <select v-model="specialtyId" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="" disabled>Selecciona una especialidad</option>
            <option v-for="sp in specialties" :key="sp.id" :value="sp.id">{{ sp.nombre }}</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Servicio</label>
          <select v-model="serviceId" :disabled="!specialtyId" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
            <option value="" disabled>Selecciona un servicio</option>
            <option v-for="s in filteredServices" :key="s.id" :value="s.id">{{ s.nombre }} ({{ s.duracionMin }} min)</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Médico</label>
          <select v-model="doctorId" :disabled="!specialtyId" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
            <option value="" disabled>Selecciona un médico</option>
            <option v-for="d in filteredDoctors" :key="d.id" :value="d.id">{{ d.nombre }}</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Fecha</label>
          <p v-if="!doctorId || !serviceId" class="mb-1 text-xs text-slate-500">
            Elige servicio y médico para ver los días disponibles.
          </p>
          <p v-else-if="loadingSlots" class="mb-1 text-xs text-slate-500">Cargando disponibilidad…</p>
          <DatePicker
            v-if="doctorId && serviceId"
            v-model="date"
            :min-date="todayIso"
            :max-date="maxDateIso"
            :disabled-dates="disabledDates"
          />
        </div>

        <div v-if="date">
          <label class="mb-1 block text-sm font-medium text-slate-700">Hora</label>
          <select v-model="time" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="" disabled>Selecciona una hora</option>
            <option v-for="t in timeOptions" :key="t" :value="t">{{ t }}</option>
          </select>
          <p v-if="timeOptions.length === 0" class="mt-1 text-xs text-red-600">
            No hay horas disponibles ese día.
          </p>
        </div>

        <p v-if="slotsError" class="text-sm text-red-600">{{ slotsError }}</p>
        <p v-if="saveError" class="text-sm text-red-600">{{ saveError }}</p>

        <button
          type="submit"
          :disabled="!canSubmit || saving"
          class="w-full rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {{ saving ? "Agendando…" : "Confirmar cita" }}
        </button>
      </form>
    </div>
  </div>
</template>
