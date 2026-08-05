<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { createItem, readItems, updateItem } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { IsoWeekday, PatientRow, WaitlistRow, WaitlistStatus } from "@/lib/directus";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import Button from "@/components/ui/Button.vue";
import TimeSelect from "@/components/ui/TimeSelect.vue";

const props = defineProps<{
  mode: "create" | "edit";
  entry?: WaitlistRow;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const catalog = useCatalogStore();
const clinica = useClinicaStore();

const DIAS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 7, label: "Domingo" },
];

const ESTADOS: { value: WaitlistStatus; label: string }[] = [
  { value: "activa", label: "Activa" },
  { value: "ofrecida", label: "Ofrecida" },
  { value: "agendada", label: "Agendada" },
  { value: "cancelada", label: "Cancelada" },
];

// --- Paciente (solo se busca/crea en modo creación) ---
const patientQuery = ref("");
const searchResults = ref<PatientRow[]>([]);
const selectedPatient = ref<PatientRow | null>(null);
const searching = ref(false);
const existingPatientLabel = ref<string | null>(null);

// --- Entrada ---
// La especialidad acota servicios y médicos. Se deriva del médico/servicio ya
// elegidos (edición) una vez que el catálogo cargó (ver onMounted).
const specialtyId = ref("");
const serviceId = ref("");
const doctorId = ref("");
const diaSemana = ref<number | "">("");
const horaDesde = ref("");
const horaHasta = ref("");
const notas = ref("");
const estado = ref<WaitlistStatus>("activa");

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

const saving = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  await catalog.load();

  if (props.mode === "edit" && props.entry) {
    const e = props.entry;
    serviceId.value = e.service;
    doctorId.value = e.doctor ?? "";
    diaSemana.value = e.dia_semana ?? "";
    horaDesde.value = e.hora_desde?.slice(0, 5) ?? "";
    horaHasta.value = e.hora_hasta?.slice(0, 5) ?? "";
    notas.value = e.notas ?? "";
    estado.value = e.estado;

    const patient = await directus.request(readItems("patients", { filter: { id: { _eq: e.patient } }, limit: 1 }));
    existingPatientLabel.value = patient[0] ? `${patient[0].nombre?.trim() || "(sin nombre)"} — ${patient[0].telefono}` : null;
  }

  if (!specialtyId.value) {
    const currentDoctor = catalog.doctors.find((d) => d.id === doctorId.value);
    const currentService = catalog.services.find((s) => s.id === serviceId.value);
    specialtyId.value =
      currentDoctor?.specialty ??
      currentService?.specialty ??
      (catalog.specialties.length === 1 ? catalog.specialties[0].id : "");
  }
});

/** Mismo patrón de búsqueda que AppointmentFormModal: por nombre o teléfono, un número puede tener varios pacientes. */
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
          // Igual que en AppointmentFormModal: los dados de baja no se agendan.
          activo: { _neq: false },
          _or: [{ nombre: { _icontains: query } }, { telefono: { _contains: query } }],
        },
        limit: 10,
      }),
    );
    if (results.length === 1) {
      pickPatient(results[0]!);
    } else {
      searchResults.value = results;
    }
  } finally {
    searching.value = false;
  }
}

function pickPatient(p: PatientRow): void {
  selectedPatient.value = p;
  searchResults.value = [];
}

const canSubmit = computed(() => {
  if (!specialtyId.value || !serviceId.value) return false;
  if (props.mode === "create" && !selectedPatient.value) return false;
  return true;
});

async function handleSubmit(): Promise<void> {
  error.value = null;
  saving.value = true;
  try {
    const payload = {
      service: serviceId.value,
      doctor: doctorId.value || null,
      dia_semana: diaSemana.value === "" ? null : (Number(diaSemana.value) as IsoWeekday),
      hora_desde: horaDesde.value ? `${horaDesde.value}:00` : null,
      hora_hasta: horaHasta.value ? `${horaHasta.value}:00` : null,
      notas: notas.value.trim() || null,
    };

    if (props.mode === "create") {
      await directus.request(
        createItem("waitlist", {
          ...payload,
          clinic: clinica.activeClinicId ?? undefined,
          patient: selectedPatient.value!.id,
          estado: "activa",
        }),
      );
    } else if (props.entry) {
      await directus.request(updateItem("waitlist", props.entry.id, { ...payload, estado: estado.value }));
    }
    emit("saved");
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo guardar la entrada de lista de espera.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="max-h-full w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-4 text-lg font-bold text-brand-800">
        {{ mode === "create" ? "Nueva entrada de lista de espera" : "Editar entrada" }}
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
              @input="selectedPatient = null"
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

          <p v-if="selectedPatient" class="mt-2 text-sm text-brand-700">
            Paciente: {{ selectedPatient.nombre?.trim() || "(sin nombre)" }} — {{ selectedPatient.telefono }}
          </p>
          <p v-else-if="patientQuery && searchResults.length === 0 && !searching" class="mt-2 text-sm text-slate-500">
            No se encontró ningún paciente con ese nombre o teléfono. La lista de espera solo admite pacientes ya registrados.
          </p>
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
            <option v-for="s in filteredServices" :key="s.id" :value="s.id">{{ s.nombre }}</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Médico</label>
          <p v-if="!specialtyId" class="mb-1 text-xs text-slate-500">Elige una especialidad para ver sus médicos.</p>
          <select v-model="doctorId" :disabled="!specialtyId" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-100">
            <option value="">Cualquiera</option>
            <option v-for="d in filteredDoctors" :key="d.id" :value="d.id">{{ d.nombre }}</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Día preferido</label>
          <select v-model="diaSemana" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30">
            <option value="">Cualquier día</option>
            <option v-for="d in DIAS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>

        <div class="flex gap-3">
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Hora desde</label>
            <TimeSelect v-model="horaDesde" />
          </div>
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Hora hasta</label>
            <TimeSelect v-model="horaHasta" />
          </div>
        </div>
        <p class="text-xs text-slate-500">Deja ambas vacías si cualquier hora sirve.</p>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Notas (opcional)</label>
          <textarea
            v-model="notas"
            rows="2"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          ></textarea>
        </div>

        <div v-if="mode === 'edit'">
          <label class="mb-1 block text-sm font-medium text-slate-700">Estado</label>
          <select v-model="estado" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30">
            <option v-for="e in ESTADOS" :key="e.value" :value="e.value">{{ e.label }}</option>
          </select>
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
