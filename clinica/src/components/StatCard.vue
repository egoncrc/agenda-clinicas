<script setup lang="ts">
import { computed } from "vue";
import StatIcon from "./ui/StatIcon.vue";

const props = withDefaults(
  defineProps<{
    label: string;
    value: number | string;
    /** Aclaración corta bajo el número (ej. "sobre 1.240 citas"). */
    hint?: string;
    tone?: "default" | "warn" | "danger" | "success";
    icon?: "check" | "clock" | "x" | "alert";
  }>(),
  { tone: "default" },
);

const valueClasses: Record<string, string> = {
  default: "text-slate-800",
  warn: "text-amber-600",
  danger: "text-red-600",
  success: "text-emerald-600",
};

const iconClasses: Record<string, string> = {
  default: "bg-slate-100 text-slate-500",
  warn: "bg-amber-100 text-amber-600",
  danger: "bg-red-100 text-red-600",
  success: "bg-emerald-100 text-emerald-600",
};

/**
 * Los reportes meten valores que no son un número corto ("10:00, 11:00",
 * "Medicina General"). Con `text-3xl` fijo desbordan la tarjeta, así que el
 * tamaño baja según el largo en vez de recortar el texto.
 */
const sizeClass = computed(() => {
  const len = String(props.value).length;
  if (len <= 6) return "text-3xl";
  if (len <= 12) return "text-2xl";
  return "text-lg";
});
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm text-slate-500">{{ label }}</p>
      <span v-if="icon" class="flex h-8 w-8 flex-none items-center justify-center rounded-lg" :class="iconClasses[tone]">
        <span class="h-4 w-4"><StatIcon :name="icon" /></span>
      </span>
    </div>
    <p class="mt-2 font-semibold break-words" :class="[valueClasses[tone], sizeClass]">{{ value }}</p>
    <p v-if="hint" class="mt-1 text-xs text-slate-400">{{ hint }}</p>
  </div>
</template>
