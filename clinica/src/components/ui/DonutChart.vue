<script setup lang="ts">
import { computed } from "vue";
import { formatCell } from "@/lib/reports/format";

/**
 * Dona en SVG con un solo `<circle>` por porción, dibujada con
 * `stroke-dasharray` + `stroke-dashoffset`: no hace falta calcular arcos ni
 * paths, solo el largo del trazo sobre la circunferencia.
 *
 * Los colores salen de la escala `brand` de src/style.css, de más oscuro a más
 * claro, así que la porción más grande es también la más intensa.
 */
const props = withDefaults(
  defineProps<{
    labels: string[];
    values: number[];
    maxSlices?: number;
  }>(),
  { maxSlices: 6 },
);

const PALETTE = [
  "var(--color-brand-700)",
  "var(--color-brand-500)",
  "var(--color-brand-400)",
  "var(--color-brand-300)",
  "var(--color-brand-200)",
  "#94a3b8",
  "#cbd5e1",
];

const RADIO = 60;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO;

const slices = computed(() => {
  const all = props.labels
    .map((label, i) => ({ label, value: props.values[i] ?? 0 }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const visible =
    all.length <= props.maxSlices
      ? all
      : [
          ...all.slice(0, props.maxSlices),
          {
            label: `Otros (${all.length - props.maxSlices})`,
            value: all.slice(props.maxSlices).reduce((sum, s) => sum + s.value, 0),
          },
        ];

  const total = visible.reduce((sum, s) => sum + s.value, 0);
  let acumulado = 0;
  return visible.map((s, i) => {
    const fraccion = total > 0 ? s.value / total : 0;
    const slice = {
      ...s,
      fraccion,
      color: PALETTE[i % PALETTE.length]!,
      dash: `${fraccion * CIRCUNFERENCIA} ${CIRCUNFERENCIA}`,
      // Negativo porque el trazo avanza en sentido horario desde el arranque.
      offset: -acumulado * CIRCUNFERENCIA,
    };
    acumulado += fraccion;
    return slice;
  });
});

const total = computed(() => slices.value.reduce((sum, s) => sum + s.value, 0));
</script>

<template>
  <div v-if="slices.length === 0" class="py-6 text-center text-sm text-slate-400">Sin datos para graficar.</div>
  <div v-else class="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
    <svg viewBox="0 0 160 160" class="h-40 w-40 flex-none -rotate-90" role="img" aria-label="Distribución">
      <circle
        v-for="s in slices"
        :key="s.label"
        cx="80"
        cy="80"
        :r="RADIO"
        fill="none"
        :stroke="s.color"
        stroke-width="26"
        :stroke-dasharray="s.dash"
        :stroke-dashoffset="s.offset"
      >
        <title>{{ s.label }}: {{ formatCell(s.fraccion, "percent") }}</title>
      </circle>
    </svg>

    <!-- La leyenda lleva el valor y el porcentaje: una dona sin cifras obliga a
         estimar áreas a ojo, que es justo lo que la gente hace mal. -->
    <ul class="w-full flex-1 space-y-1.5">
      <li v-for="s in slices" :key="s.label" class="flex items-center gap-2 text-sm">
        <span class="h-2.5 w-2.5 flex-none rounded-full" :style="{ backgroundColor: s.color }" />
        <span class="flex-1 truncate text-slate-600" :title="s.label">{{ s.label }}</span>
        <span class="flex-none tabular-nums text-slate-500">{{ formatCell(s.value, "number") }}</span>
        <span class="w-12 flex-none text-right tabular-nums text-slate-400">
          {{ formatCell(s.fraccion, "percent") }}
        </span>
      </li>
      <li class="flex items-center gap-2 border-t border-slate-100 pt-1.5 text-sm font-medium text-slate-700">
        <span class="flex-1">Total</span>
        <span class="tabular-nums">{{ formatCell(total, "number") }}</span>
        <span class="w-12" />
      </li>
    </ul>
  </div>
</template>
