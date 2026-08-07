<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useClinicaStore } from "@/stores/clinica";
import { monthRange, toYmd } from "@/lib/dateRanges";
import { rangeFromPreset, shiftRange } from "@/lib/reports/filters";
import type { DatePreset, FilterKey, GroupBy, ReportFilters, ReportRole } from "@/lib/reports/types";
import type { ClinicDoctor, ServiceRow, SpecialtyRow } from "@/lib/directus";

/**
 * Barra de filtros dirigida por la definición del reporte: solo dibuja los
 * controles que ese reporte declara en `filters`, así que un reporte nuevo no
 * obliga a tocar este componente.
 */
const props = defineProps<{
  modelValue: ReportFilters;
  visible: FilterKey[];
  role: ReportRole;
  ownDoctorName: string | null;
  ownSpecialtyName: string | null;
  doctors: ClinicDoctor[];
  specialties: SpecialtyRow[];
  services: ServiceRow[];
  loading: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [ReportFilters] }>();

const clinica = useClinicaStore();

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

const mes = monthRange();
const desdeYmd = ref(toYmd(mes.start!));
const hastaYmd = ref(toYmd(mes.end!));

const shows = (key: FilterKey) => props.visible.includes(key);

function update(patch: Partial<ReportFilters>): void {
  emit("update:modelValue", { ...props.modelValue, ...patch });
}

/** Sin ancla: `rangeFromPreset` vuelve al presente, así que el propio botón del preset es el "volver a hoy". */
function setPreset(preset: DatePreset): void {
  update({ preset, ...rangeFromPreset(preset, desdeYmd.value, hastaYmd.value) });
}

function navegar(direction: -1 | 1): void {
  update(shiftRange(props.modelValue, direction));
}

// Las dos fechas del rango personalizado se aplican juntas: emitir en cada
// tecleo dispararía consultas con un rango a medio escribir.
watch([desdeYmd, hastaYmd], () => {
  if (props.modelValue.preset !== "personalizado") return;
  if (!desdeYmd.value || !hastaYmd.value) return;
  update(rangeFromPreset("personalizado", desdeYmd.value, hastaYmd.value));
});

// "Día" y no "Hoy": con las flechas de navegación el período puede estar parado
// en cualquier día, y un botón activo que dice "Hoy" mostrando el martes pasado
// miente. El `value` sigue siendo "hoy" (lo leen CalendarBoard y defaultFilters).
const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "hoy", label: "Día" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
  { value: "personalizado", label: "Personalizado" },
];

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "especialidad", label: "Por especialidad" },
  { value: "medico", label: "Por médico" },
  { value: "ambos", label: "Ambos" },
];

/**
 * Un médico se ve solo a sí mismo: ni el selector de médico ni el de
 * especialidad se le ofrecen, quedan fijos y se explica por qué.
 *
 * Ojo con la especialidad: se muestra pero NO se filtra por ella
 * (`filters.specialtyId` queda en `null`). La especialidad de una cita es la de
 * su SERVICIO, no la del médico (ver ReportContext), así que filtrarla le
 * escondería sus propias citas de servicios de otra especialidad.
 */
const doctorLocked = computed(() => props.role === "medico");

/** Los servicios y médicos se acotan a la especialidad elegida, para no ofrecer combinaciones vacías. */
const doctorOptions = computed(() =>
  props.modelValue.specialtyId
    ? props.doctors.filter((d) => d.specialty === props.modelValue.specialtyId)
    : props.doctors,
);
const serviceOptions = computed(() =>
  props.modelValue.specialtyId
    ? props.services.filter((s) => s.specialty === props.modelValue.specialtyId)
    : props.services,
);

/**
 * Al cambiar de especialidad se limpia lo que deje de tener sentido. Sin esto,
 * queda un filtro invisible activo (el médico anterior, ya fuera de la lista) y
 * el reporte sale vacío sin explicación.
 */
function setSpecialty(value: string): void {
  const specialtyId = value || null;
  const patch: Partial<ReportFilters> = { specialtyId };
  if (!doctorLocked.value && props.modelValue.doctorId) {
    const sigue = props.doctors.some(
      (d) => d.id === props.modelValue.doctorId && (!specialtyId || d.specialty === specialtyId),
    );
    if (!sigue) patch.doctorId = null;
  }
  if (props.modelValue.serviceId) {
    const sigue = props.services.some(
      (s) => s.id === props.modelValue.serviceId && (!specialtyId || s.specialty === specialtyId),
    );
    if (!sigue) patch.serviceId = null;
  }
  update(patch);
}
</script>

<template>
  <div class="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div class="flex flex-wrap items-end gap-3">
      <!-- Período -->
      <div v-if="shows('rango')">
        <label class="mb-1 block text-xs font-medium text-slate-500">Período</label>
        <div class="flex items-center gap-1.5">
          <!-- Retroceder/avanzar un día, una semana o un mes según el preset. No
               hay límite: el rango se calcula sobre la fecha actual del filtro. -->
          <button
            v-if="modelValue.preset !== 'personalizado'"
            type="button"
            class="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
            title="Período anterior"
            aria-label="Período anterior"
            @click="navegar(-1)"
          >
            ←
          </button>
          <div class="inline-flex rounded-lg border border-slate-300 p-0.5">
            <button
              v-for="p in PRESETS"
              :key="p.value"
              type="button"
              class="rounded-md px-3 py-1.5 text-xs font-medium transition"
              :class="
                modelValue.preset === p.value
                  ? 'bg-brand-700 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              "
              :title="modelValue.preset === p.value ? 'Volver al presente' : undefined"
              @click="setPreset(p.value)"
            >
              {{ p.label }}
            </button>
          </div>
          <button
            v-if="modelValue.preset !== 'personalizado'"
            type="button"
            class="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
            title="Período siguiente"
            aria-label="Período siguiente"
            @click="navegar(1)"
          >
            →
          </button>
        </div>
      </div>

      <template v-if="shows('rango') && modelValue.preset === 'personalizado'">
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-500">Desde</label>
          <input v-model="desdeYmd" type="date" :class="INPUT_CLASS" />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-500">Hasta</label>
          <input v-model="hastaYmd" type="date" :class="INPUT_CLASS" />
        </div>
      </template>

      <!-- Sede: solo tiene sentido si el usuario llega a más de una. -->
      <div v-if="shows('clinicId') && clinica.clinics.length > 1">
        <label class="mb-1 block text-xs font-medium text-slate-500">Sede</label>
        <select
          :value="modelValue.clinicId ?? ''"
          :class="INPUT_CLASS"
          @change="update({ clinicId: ($event.target as HTMLSelectElement).value || null })"
        >
          <option value="">Todas las sedes</option>
          <option v-for="c in clinica.clinics" :key="c.id" :value="c.id">{{ c.nombre }}</option>
        </select>
      </div>

      <div v-if="shows('specialtyId')">
        <label class="mb-1 block text-xs font-medium text-slate-500">Especialidad</label>
        <!-- Mismo tratamiento que el selector de médico: al médico se le muestra
             deshabilitada la suya (las dos, si trabaja en dos sedes) en vez de
             esconder el control, para que entienda el alcance de lo que ve. -->
        <input
          v-if="doctorLocked"
          :value="ownSpecialtyName ?? 'Sin especificar'"
          type="text"
          disabled
          :class="INPUT_CLASS"
        />
        <select
          v-else
          :value="modelValue.specialtyId ?? ''"
          :class="INPUT_CLASS"
          @change="setSpecialty(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Todas</option>
          <option v-for="s in specialties" :key="s.id" :value="s.id">{{ s.nombre }}</option>
        </select>
      </div>

      <div v-if="shows('doctorId')">
        <label class="mb-1 block text-xs font-medium text-slate-500">Médico</label>
        <!-- Para un médico se muestra su nombre deshabilitado en vez de esconder el
             control: así entiende que los datos son solo suyos y no cree que el
             reporte está incompleto. -->
        <input
          v-if="doctorLocked"
          :value="ownDoctorName ?? 'Mis citas'"
          type="text"
          disabled
          :class="INPUT_CLASS"
        />
        <select
          v-else
          :value="modelValue.doctorId ?? ''"
          :class="INPUT_CLASS"
          @change="update({ doctorId: ($event.target as HTMLSelectElement).value || null })"
        >
          <option value="">Todos</option>
          <option v-for="d in doctorOptions" :key="d.id" :value="d.id">{{ d.nombre }}</option>
        </select>
      </div>

      <div v-if="shows('serviceId')">
        <label class="mb-1 block text-xs font-medium text-slate-500">Servicio</label>
        <select
          :value="modelValue.serviceId ?? ''"
          :class="INPUT_CLASS"
          @change="update({ serviceId: ($event.target as HTMLSelectElement).value || null })"
        >
          <option value="">Todos</option>
          <option v-for="s in serviceOptions" :key="s.id" :value="s.id">{{ s.nombre }}</option>
        </select>
      </div>

      <!-- Agrupar no le sirve a un médico: siempre es él. -->
      <div v-if="shows('groupBy') && !doctorLocked">
        <label class="mb-1 block text-xs font-medium text-slate-500">Agrupar</label>
        <select
          :value="modelValue.groupBy"
          :class="INPUT_CLASS"
          @change="update({ groupBy: ($event.target as HTMLSelectElement).value as GroupBy })"
        >
          <option v-for="g in GROUPS" :key="g.value" :value="g.value">{{ g.label }}</option>
        </select>
      </div>

      <span v-if="loading" class="ml-auto flex items-center gap-2 pb-2 text-xs text-slate-500">
        <span class="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
        Actualizando…
      </span>
    </div>
  </div>
</template>
