<script setup lang="ts">
import { ref } from "vue";
import { createItem, updateItem } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { IsoWeekday, WorkingHoursRow } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useClinicaStore } from "@/stores/clinica";
import Button from "@/components/ui/Button.vue";
import TimeSelect from "@/components/ui/TimeSelect.vue";

const clinica = useClinicaStore();

const props = defineProps<{
  doctorId: string;
  mode: "create" | "edit";
  row?: WorkingHoursRow;
  initialDia?: IsoWeekday;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const DIAS: { value: IsoWeekday; label: string }[] = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 7, label: "Domingo" },
];

function toHm(t: string): string {
  return t.slice(0, 5);
}

const dia = ref<IsoWeekday>(props.row?.dia_semana ?? props.initialDia ?? 1);
const horaInicio = ref(props.row ? toHm(props.row.hora_inicio) : "");
const horaFin = ref(props.row ? toHm(props.row.hora_fin) : "");
const saving = ref(false);
const error = ref<string | null>(null);

async function handleSubmit(): Promise<void> {
  error.value = null;
  if (!horaInicio.value || !horaFin.value || horaInicio.value >= horaFin.value) {
    error.value = "La hora de fin debe ser posterior a la de inicio.";
    return;
  }
  saving.value = true;
  try {
    if (props.mode === "create") {
      await directus.request(
        createItem("working_hours", {
          doctor: props.doctorId,
          // El bloque pertenece a la clínica activa: el mismo médico puede
          // atender otros días en otra sede.
          clinic: clinica.activeClinicId ?? undefined,
          dia_semana: dia.value,
          hora_inicio: `${horaInicio.value}:00`,
          hora_fin: `${horaFin.value}:00`,
        }),
      );
    } else if (props.row) {
      await directus.request(
        updateItem("working_hours", props.row.id, {
          dia_semana: dia.value,
          hora_inicio: `${horaInicio.value}:00`,
          hora_fin: `${horaFin.value}:00`,
        }),
      );
    }
    emit("saved");
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo guardar el horario.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-4 text-lg font-bold text-brand-800">
        {{ mode === "create" ? "Agregar bloque de horario" : "Editar bloque de horario" }}
      </h2>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Día</label>
          <select
            v-model="dia"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option v-for="d in DIAS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>

        <div class="flex gap-3">
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Inicio</label>
            <TimeSelect v-model="horaInicio" />
          </div>
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Fin</label>
            <TimeSelect v-model="horaFin" />
          </div>
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="secondary" @click="emit('close')">Cancelar</Button>
          <Button type="submit" :loading="saving">{{ saving ? "Guardando…" : "Guardar" }}</Button>
        </div>
      </form>
    </div>
  </div>
</template>
