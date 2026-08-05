<script setup lang="ts">
import { computed } from "vue";
import { formatCell } from "@/lib/reports/format";

/**
 * Serie temporal en SVG, con una o dos líneas (nuevos vs recurrentes,
 * cancelaciones por día).
 *
 * Coordenadas en un `viewBox` fijo con `preserveAspectRatio="none"` en el eje X:
 * el gráfico se estira al ancho disponible sin recalcular nada en JavaScript, y
 * los trazos llevan `vector-effect="non-scaling-stroke"` para no engordar al
 * estirarse.
 */
const props = withDefaults(
  defineProps<{
    labels: string[];
    values: number[];
    /** Segunda serie opcional. */
    values2?: number[];
    seriesLabel?: string;
    seriesLabel2?: string;
  }>(),
  { seriesLabel: "Serie" },
);

const W = 600;
const H = 200;
const PAD = 8;

const max = computed(() =>
  Math.max(1, ...props.values, ...(props.values2 ?? [])),
);

interface Punto {
  x: number;
  y: number;
  label: string;
  valor: number;
}

/**
 * Devuelve los puntos calculados (no solo el string de `points`): hacen falta
 * por separado para dibujar un `<circle>` en cada uno. SIN los círculos, una
 * serie de UN SOLO PUNTO —el caso más común, ya que el filtro por defecto es
 * "Mes"— quedaba invisible: un `<polyline>` con un único punto no traza ningún
 * segmento, así que el gráfico se veía vacío aunque los datos estuvieran bien.
 */
function toPoints(values: number[]): Punto[] {
  const n = values.length;
  return values.map((v, i) => {
    // Con un solo punto no hay recorrido horizontal: se centra en vez de dividir por cero.
    const x = n === 1 ? W / 2 : (i / (n - 1)) * (W - PAD * 2) + PAD;
    const y = H - PAD - (v / max.value) * (H - PAD * 2);
    return { x, y, label: props.labels[i] ?? "", valor: v };
  });
}

function toPointsAttr(points: Punto[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

const puntos1 = computed(() => toPoints(props.values));
const puntos2 = computed(() => (props.values2 ? toPoints(props.values2) : []));

/** Con muchos meses las etiquetas se pisan: se muestra una de cada N. */
const paso = computed(() => Math.ceil(props.labels.length / 8));
</script>

<template>
  <div v-if="labels.length === 0" class="py-6 text-center text-sm text-slate-400">Sin datos para graficar.</div>
  <div v-else>
    <div class="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
      <span class="flex items-center gap-1.5">
        <span class="h-0.5 w-4 rounded bg-brand-600" />{{ seriesLabel }}
      </span>
      <span v-if="values2" class="flex items-center gap-1.5">
        <span class="h-0.5 w-4 rounded bg-amber-500" />{{ seriesLabel2 }}
      </span>
      <span class="ml-auto tabular-nums text-slate-400">máx. {{ formatCell(max, "number") }}</span>
    </div>

    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="h-48 w-full" role="img">
      <!-- Rejilla: cuatro líneas de referencia, suficientes para leer alturas sin ensuciar. -->
      <line
        v-for="f in [0, 0.25, 0.5, 0.75, 1]"
        :key="f"
        x1="0"
        :y1="PAD + f * (H - PAD * 2)"
        :x2="W"
        :y2="PAD + f * (H - PAD * 2)"
        stroke="currentColor"
        class="text-slate-100"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <polyline
        :points="toPointsAttr(puntos1)"
        fill="none"
        stroke="var(--color-brand-600)"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
      <polyline
        v-if="puntos2.length > 0"
        :points="toPointsAttr(puntos2)"
        fill="none"
        stroke="#f59e0b"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />

      <!-- Un punto por dato, en las dos series: es lo único que hace visible una
           serie de un solo mes, y de paso marca cada mes en las series largas. -->
      <circle
        v-for="(p, i) in puntos1"
        :key="`s1-${i}`"
        :cx="p.x"
        :cy="p.y"
        r="3.5"
        fill="var(--color-brand-600)"
        vector-effect="non-scaling-stroke"
      >
        <title>{{ seriesLabel }} · {{ p.label }}: {{ formatCell(p.valor, 'number') }}</title>
      </circle>
      <circle
        v-for="(p, i) in puntos2"
        :key="`s2-${i}`"
        :cx="p.x"
        :cy="p.y"
        r="3.5"
        fill="#f59e0b"
        vector-effect="non-scaling-stroke"
      >
        <title>{{ seriesLabel2 }} · {{ p.label }}: {{ formatCell(p.valor, 'number') }}</title>
      </circle>
    </svg>

    <div class="mt-1 flex justify-between text-[10px] text-slate-400">
      <span v-for="(label, i) in labels" :key="i" :class="i % paso === 0 ? '' : 'invisible'" class="truncate">
        {{ label }}
      </span>
    </div>
  </div>
</template>
