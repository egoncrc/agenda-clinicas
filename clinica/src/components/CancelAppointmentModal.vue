<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import Button from "@/components/ui/Button.vue";
import StatIcon from "@/components/ui/StatIcon.vue";

/**
 * Confirmación de cancelación con motivo, para cancelar una cita en línea desde
 * la tabla de Citas sin abrir el formulario completo de edición.
 *
 * Es un componente propio y no una variante de `useConfirm` porque ese
 * composable es un singleton que resuelve un booleano y lo comparten varias
 * pantallas; agregarle un campo de texto cambiaría su contrato para todas.
 */
const props = defineProps<{
  /** A quién se le cancela la cita, para que quien confirma vea que es la fila correcta. */
  pacienteNombre: string;
  fechaTexto: string;
  horaTexto: string;
  saving?: boolean;
}>();

const emit = defineEmits<{ close: []; confirm: [motivo: string | null] }>();

const motivo = ref("");

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && !props.saving) emit("close");
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

function handleConfirm(): void {
  emit("confirm", motivo.value.trim() || null);
}
</script>

<template>
  <div class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4 py-6" @click.self="!saving && emit('close')">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
          <span class="h-5 w-5"><StatIcon name="alert" /></span>
        </div>
        <div class="min-w-0 flex-1 pt-1">
          <h2 class="font-display text-lg font-bold text-brand-800">Cancelar esta cita</h2>
          <p class="mt-1 text-sm text-slate-500">
            {{ pacienteNombre }} — {{ fechaTexto }} a las {{ horaTexto }}. La cita quedará marcada como cancelada.
          </p>
        </div>
      </div>

      <!-- Opcional a propósito, igual que en el formulario de edición: obligar un
           motivo haría que se escriba cualquier cosa para poder guardar, y el
           reporte de Cancelaciones se llenaría de ruido en vez de quedarse
           honestamente vacío. -->
      <div class="mt-4">
        <label class="mb-1 block text-sm font-medium text-slate-700">
          Motivo <span class="font-normal text-slate-400">(opcional)</span>
        </label>
        <input
          v-model="motivo"
          type="text"
          maxlength="200"
          placeholder="Ej: el paciente reagenda, enfermedad, viaje…"
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          @keydown.enter.prevent="handleConfirm"
        />
        <p class="mt-1 text-xs text-slate-500">Aparece en el reporte de Cancelaciones.</p>
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <Button variant="secondary" :disabled="saving" @click="emit('close')">Volver</Button>
        <Button variant="danger" :disabled="saving" @click="handleConfirm">
          {{ saving ? "Cancelando…" : "Cancelar cita" }}
        </Button>
      </div>
    </div>
  </div>
</template>
