<script setup lang="ts">
import { ref, watch } from "vue";

/**
 * Reemplaza <input type="time">: el atributo `step` de un time input nativo
 * solo cambia el incremento de las flechas del selector del navegador, pero
 * igual deja escribir cualquier minuto a mano (el campo queda ":invalid" pero
 * no lo impide). Acá los minutos literalmente solo tienen las opciones 00/30
 * como <option>, así que no hay forma de elegir otra cosa.
 *
 * Hora y minuto se guardan en refs locales (no derivadas de `modelValue` en
 * cada render): así, elegir la hora primero no se "pierde" mientras el
 * minuto todavía está sin elegir, y viceversa. Solo se emite un valor
 * "HH:mm" completo cuando ambos están elegidos.
 */
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [string] }>();

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "30"];

const hour = ref(props.modelValue.split(":")[0] ?? "");
const minute = ref(props.modelValue.split(":")[1] ?? "");

watch(
  () => props.modelValue,
  (v) => {
    hour.value = v.split(":")[0] ?? "";
    minute.value = v.split(":")[1] ?? "";
  },
);

function commit(): void {
  emit("update:modelValue", hour.value && minute.value ? `${hour.value}:${minute.value}` : "");
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <select
      v-model="hour"
      class="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      @change="commit"
    >
      <option value="">HH</option>
      <option v-for="h in HOURS" :key="h" :value="h">{{ h }}</option>
    </select>
    <span class="text-slate-400">:</span>
    <select
      v-model="minute"
      class="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      @change="commit"
    >
      <option value="">MM</option>
      <option v-for="m in MINUTES" :key="m" :value="m">{{ m }}</option>
    </select>
  </div>
</template>
