<script setup lang="ts">
import { ref } from "vue";
import { createItem, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus } from "@/lib/directus";
import type { TimeOffRow } from "@/lib/directus";
import { CLINIC_TIMEZONE, toIsoOrThrow } from "@/lib/dateRanges";
import { dateCompareFilter } from "@/lib/queryHelpers";
import {
  buildAffectedWarning,
  cancelAppointments,
  fetchFutureActiveAppointments,
  MOTIVO_AUSENCIA,
} from "@/lib/cancelCascade";
import type { AffectedAppointment } from "@/lib/cancelCascade";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useConfirm } from "@/composables/useConfirm";
import { useClinicaStore } from "@/stores/clinica";
import Button from "@/components/ui/Button.vue";
import TimeSelect from "@/components/ui/TimeSelect.vue";

const clinica = useClinicaStore();

const props = defineProps<{
  doctorId: string;
  mode: "create" | "edit";
  row?: TimeOffRow;
}>();

/** `saved` lleva cuántas citas se cancelaron, para que la vista avise a la recepción. */
const emit = defineEmits<{ close: []; saved: [canceladas: number] }>();

const confirm = useConfirm();

function toDateInput(iso: string): string {
  return DateTime.fromISO(iso, { zone: CLINIC_TIMEZONE }).toFormat("yyyy-LL-dd");
}
function toTimeInput(iso: string): string {
  return DateTime.fromISO(iso, { zone: CLINIC_TIMEZONE }).toFormat("HH:mm");
}
function toDateTime(fecha: string, hora: string): DateTime {
  return DateTime.fromFormat(`${fecha} ${hora}`, "yyyy-LL-dd HH:mm", { zone: CLINIC_TIMEZONE });
}

const inicioFecha = ref(props.row ? toDateInput(props.row.inicio) : "");
const inicioHora = ref(props.row ? toTimeInput(props.row.inicio) : "");
const finFecha = ref(props.row ? toDateInput(props.row.fin) : "");
const finHora = ref(props.row ? toTimeInput(props.row.fin) : "");
const motivo = ref(props.row?.motivo ?? "");
const saving = ref(false);
const error = ref<string | null>(null);

/**
 * Citas activas que quedarían dentro de la ausencia. Mismo criterio de solape que
 * el hook `time-off-cascade-hook` de Directus: la cita empieza antes de que acabe
 * la ausencia y termina después de que empiece. El resto de condiciones (médico,
 * clínica, estados cancelables y solo futuras) las pone `fetchFutureActiveAppointments`.
 */
async function findAffectedAppointments(
  doctor: string,
  clinic: string,
  inicioIso: string,
  finIso: string,
): Promise<AffectedAppointment[]> {
  return fetchFutureActiveAppointments(doctor, clinic, [
    { inicio: dateCompareFilter("_lt", finIso) },
    { fin: dateCompareFilter("_gt", inicioIso) },
  ]);
}

async function handleSubmit(): Promise<void> {
  error.value = null;
  if (!inicioFecha.value || !inicioHora.value || !finFecha.value || !finHora.value) {
    error.value = "Completa fecha y hora de inicio y fin.";
    return;
  }
  const inicio = toDateTime(inicioFecha.value, inicioHora.value);
  const fin = toDateTime(finFecha.value, finHora.value);
  if (fin <= inicio) {
    error.value = "El fin debe ser posterior al inicio.";
    return;
  }
  saving.value = true;
  try {
    const inicioIso = toIsoOrThrow(inicio);
    const finIso = toIsoOrThrow(fin);
    // Al editar, el médico y la clínica de la ausencia son los de la fila: el
    // formulario no permite cambiarlos.
    const doctor = props.mode === "edit" && props.row ? props.row.doctor : props.doctorId;
    const clinic = props.mode === "edit" && props.row ? props.row.clinic : clinica.activeClinicId;
    if (!clinic) {
      error.value = "No hay una clínica activa seleccionada.";
      return;
    }

    const afectadas = await findAffectedAppointments(doctor, clinic, inicioIso, finIso);
    if (afectadas.length > 0) {
      const cuantas = afectadas.length === 1 ? "Hay 1 cita agendada" : `Hay ${afectadas.length} citas agendadas`;
      const ok = await confirm({
        title: "Hay citas en ese periodo",
        message: await buildAffectedWarning(afectadas, `${cuantas} dentro de ese periodo:`),
        confirmLabel: "Cancelar esas citas",
      });
      // Se aborta sin guardar: la ausencia y la cancelación de sus citas son una
      // sola decisión, no tiene sentido registrar una a medias.
      if (!ok) return;
    }

    const payload = { inicio: inicioIso, fin: finIso, motivo: motivo.value.trim() || null };
    // Primero la ausencia y después las cancelaciones: al revés, un fallo al
    // guardarla dejaría citas canceladas sin ningún motivo que lo explique.
    if (props.mode === "create") {
      await directus.request(createItem("time_off", { doctor, clinic, ...payload }));
    } else if (props.row) {
      await directus.request(updateItem("time_off", props.row.id, payload));
    }

    // Misma trazabilidad que escribe el hook `time-off-cascade-hook`, redundante e
    // idempotente a propósito (ver el docblock de cancelCascade.ts).
    await cancelAppointments(afectadas, MOTIVO_AUSENCIA);

    emit("saved", afectadas.length);
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo guardar la suspensión.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-4 text-lg font-bold text-brand-800">
        {{ mode === "create" ? "Agregar suspensión" : "Editar suspensión" }}
      </h2>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Inicio</label>
          <div class="flex gap-2">
            <input
              v-model="inicioFecha"
              type="date"
              class="w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <TimeSelect v-model="inicioHora" class="w-1/2" />
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Fin</label>
          <div class="flex gap-2">
            <input
              v-model="finFecha"
              type="date"
              class="w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <TimeSelect v-model="finHora" class="w-1/2" />
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Motivo (opcional)</label>
          <input
            v-model="motivo"
            type="text"
            placeholder="Vacaciones, permiso, congreso…"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
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
