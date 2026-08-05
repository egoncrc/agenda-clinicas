<script setup lang="ts">
import { computed } from "vue";
import { formatCell } from "@/lib/reports/format";
import type { ColumnFormat } from "@/lib/reports/types";

/**
 * Barras horizontales en SVG. Horizontales y no verticales a propósito: las
 * etiquetas de estos reportes son nombres largos ("Medicina General", "Dra.
 * Fernández"), que en vertical hay que rotar o recortar.
 *
 * Sin librería de gráficos, igual que el resto del panel: el ancho de barra es
 * una regla de tres y las etiquetas son HTML, que se lee mejor que un `<text>`
 * de SVG y hereda la tipografía sin trabajo extra.
 */
const props = withDefaults(
  defineProps<{
    labels: string[];
    values: number[];
    valueFormat?: ColumnFormat;
    /** Cuántas barras mostrar antes de resumir el resto. */
    maxBars?: number;
  }>(),
  { valueFormat: "number", maxBars: 12 },
);

const items = computed(() => {
  const all = props.labels.map((label, i) => ({ label, value: props.values[i] ?? 0 }));
  if (all.length <= props.maxBars) return all;
  // Se agrupa la cola en "Otros" en vez de cortarla: un gráfico que oculta filas
  // sin decirlo hace que las proporciones se lean mal.
  const visible = all.slice(0, props.maxBars);
  const resto = all.slice(props.maxBars).reduce((sum, i) => sum + i.value, 0);
  return [...visible, { label: `Otros (${all.length - props.maxBars})`, value: resto }];
});

/** Denominador siempre ≥ 1: evita dividir por cero cuando todos los valores son 0. */
const max = computed(() => Math.max(1, ...items.value.map((i) => i.value)));
</script>

<template>
  <div v-if="items.length === 0" class="py-6 text-center text-sm text-slate-400">Sin datos para graficar.</div>
  <ul v-else class="space-y-2">
    <li v-for="item in items" :key="item.label" class="flex items-center gap-3">
      <span class="w-32 flex-none truncate text-xs text-slate-600 sm:w-44" :title="item.label">{{ item.label }}</span>
      <span class="h-2.5 flex-1 rounded-full bg-slate-100">
        <span
          class="block h-2.5 rounded-full bg-brand-600 transition-all"
          :style="{ width: `${(item.value / max) * 100}%` }"
        />
      </span>
      <span class="w-16 flex-none text-right text-xs tabular-nums text-slate-500">
        {{ formatCell(item.value, valueFormat) }}
      </span>
    </li>
  </ul>
</template>
