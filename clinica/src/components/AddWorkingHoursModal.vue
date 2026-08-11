<script setup lang="ts">
import { ref } from "vue";
import { createItem, updateItem } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { IsoWeekday, WorkingHoursRow } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useConfirm } from "@/composables/useConfirm";
import { useClinicaStore } from "@/stores/clinica";
import {
  buildAffectedWarning,
  cancelAppointments,
  findAppointmentsInRemoved,
  MOTIVO_CAMBIO_HORARIO,
} from "@/lib/cancelCascade";
import { overlappingBlock, removedIntervalsByDay } from "@/lib/workingHours";
import type { HoursBlock } from "@/lib/workingHours";
import type { ScheduleChangeResult } from "@/lib/workingHours";
import Button from "@/components/ui/Button.vue";
import TimeSelect from "@/components/ui/TimeSelect.vue";

const clinica = useClinicaStore();
const confirm = useConfirm();

const props = defineProps<{
  doctorId: string;
  mode: "create" | "edit";
  row?: WorkingHoursRow;
  initialDia?: IsoWeekday;
  /** Todos los bloques del médico en la clínica activa, ya cargados por la vista. */
  existingRows: WorkingHoursRow[];
}>();

/** `saved` lleva el resultado del cambio, para que la vista lo cuente en pantalla. */
const emit = defineEmits<{ close: []; saved: [resultado: ScheduleChangeResult] }>();

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

function toHhmmss(hm: string): string {
  return `${hm}:00`;
}

async function handleSubmit(): Promise<void> {
  error.value = null;
  if (!horaInicio.value || !horaFin.value || horaInicio.value >= horaFin.value) {
    error.value = "La hora de fin debe ser posterior a la de inicio.";
    return;
  }

  const candidato: HoursBlock = {
    dia_semana: dia.value,
    hora_inicio: toHhmmss(horaInicio.value),
    hora_fin: toHhmmss(horaFin.value),
  };

  // Al editar, la propia fila no cuenta como rival de sí misma.
  const hermanos = props.existingRows.filter((r) => r.id !== props.row?.id);
  const choque = overlappingBlock(candidato, hermanos);
  if (choque) {
    error.value = `Ese bloque se superpone con el de ${toHm(choque.hora_inicio)}–${toHm(choque.hora_fin)} del mismo día.`;
    return;
  }

  saving.value = true;
  try {
    const clinic = props.mode === "edit" && props.row ? props.row.clinic : clinica.activeClinicId;
    if (!clinic) {
      error.value = "No hay una clínica activa seleccionada.";
      return;
    }

    // Horario tal como quedaría: con el bloque nuevo, o con la fila ya reemplazada.
    const despues: HoursBlock[] =
      props.mode === "create"
        ? [...props.existingRows, candidato]
        : props.existingRows.map((r) => (r.id === props.row?.id ? { ...r, ...candidato } : r));

    const removed = removedIntervalsByDay(props.existingRows, despues);
    const afectadas = await findAppointmentsInRemoved(props.doctorId, clinic, removed);
    if (afectadas.length > 0) {
      const cuantas = afectadas.length === 1 ? "Hay 1 cita agendada" : `Hay ${afectadas.length} citas agendadas`;
      const ok = await confirm({
        title: "Hay citas en el horario que se quita",
        message: await buildAffectedWarning(afectadas, `${cuantas} en el horario que deja de estar disponible:`),
        confirmLabel: "Cancelar esas citas",
      });
      // Se aborta sin guardar: el cambio de horario y la cancelación de sus citas
      // son una sola decisión, no tiene sentido registrar una a medias.
      if (!ok) return;
    }

    // Primero el horario y después las cancelaciones: al revés, un fallo al
    // guardarlo dejaría citas canceladas sin ningún motivo que lo explique.
    if (props.mode === "create") {
      await directus.request(
        createItem("working_hours", {
          doctor: props.doctorId,
          // El bloque pertenece a la clínica activa: el mismo médico puede
          // atender otros días en otra sede.
          clinic,
          dia_semana: dia.value,
          hora_inicio: candidato.hora_inicio,
          hora_fin: candidato.hora_fin,
        }),
      );
    } else if (props.row) {
      await directus.request(
        updateItem("working_hours", props.row.id, {
          dia_semana: dia.value,
          hora_inicio: candidato.hora_inicio,
          hora_fin: candidato.hora_fin,
        }),
      );
    }

    await cancelAppointments(afectadas, MOTIVO_CAMBIO_HORARIO);
    emit("saved", { canceladas: afectadas.length, quitoHorario: removed.size > 0 });
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
