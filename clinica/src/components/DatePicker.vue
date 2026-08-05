<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { DateTime } from "luxon";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";

const props = defineProps<{
  modelValue: string; // "yyyy-LL-dd"
  /** Días de la semana (1=lunes..7=domingo, ISO) que no se pueden elegir. */
  disabledWeekdays?: number[];
  /** Fecha mínima seleccionable ("yyyy-LL-dd"), ej. hoy para no agendar en el pasado. */
  minDate?: string;
  /** Fecha máxima seleccionable ("yyyy-LL-dd"); útil cuando solo se verificó disponibilidad hasta cierto horizonte. */
  maxDate?: string;
  /** Fechas puntuales ("yyyy-LL-dd") deshabilitadas además del patrón semanal, ej. días sin ningún hueco real disponible. */
  disabledDates?: string[];
}>();

const emit = defineEmits<{
  "update:modelValue": [string];
  /** Rango de fechas ("yyyy-LL-dd") que abarca la grilla visible, incluyendo días de relleno del mes anterior/siguiente. */
  "visible-range-change": [{ from: string; to: string }];
}>();

const today = DateTime.now().setZone(CLINIC_TIMEZONE).startOf("day");
const todayIso = today.toFormat("yyyy-LL-dd");

const viewMonth = ref(
  (props.modelValue
    ? DateTime.fromFormat(props.modelValue, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE })
    : today
  ).startOf("month"),
);

watch(
  () => props.modelValue,
  (v) => {
    if (v) viewMonth.value = DateTime.fromFormat(v, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE }).startOf("month");
  },
);

const minDt = computed(() =>
  props.minDate ? DateTime.fromFormat(props.minDate, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE }).startOf("day") : null,
);
const maxDt = computed(() =>
  props.maxDate ? DateTime.fromFormat(props.maxDate, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE }).startOf("day") : null,
);
const disabledDatesSet = computed(() => new Set(props.disabledDates ?? []));

interface Cell {
  iso: string;
  day: number;
  inMonth: boolean;
  disabled: boolean;
}

const weeks = computed<Cell[][]>(() => {
  const start = viewMonth.value.startOf("week");
  const end = viewMonth.value.endOf("month").endOf("week");
  const cells: Cell[] = [];
  let cursor = start;
  while (cursor <= end) {
    const disabledByWeekday = (props.disabledWeekdays ?? []).includes(cursor.weekday);
    const disabledByMin = minDt.value ? cursor < minDt.value : false;
    const disabledByMax = maxDt.value ? cursor > maxDt.value : false;
    const disabledByDate = disabledDatesSet.value.has(cursor.toFormat("yyyy-LL-dd"));
    cells.push({
      iso: cursor.toFormat("yyyy-LL-dd"),
      day: cursor.day,
      inMonth: cursor.hasSame(viewMonth.value, "month"),
      disabled: disabledByWeekday || disabledByMin || disabledByMax || disabledByDate,
    });
    cursor = cursor.plus({ days: 1 });
  }
  const result: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) result.push(cells.slice(i, i + 7));
  return result;
});

// Avisa a quien nos usa qué rango quedó visible, para que pueda calcular
// disabledDates perezosamente por mes en vez de precalcular un horizonte fijo.
//
// `weeks` también recalcula cuando cambia `disabledDates` (recibido como prop)
// — y quien nos usa típicamente recalcula `disabledDates` a partir de este
// mismo emit. Sin el guard de abajo eso es un ciclo infinito: emitir -> el
// padre recalcula disabledDates -> nueva referencia de array -> `weeks`
// vuelve a recalcular -> se vuelve a emitir -> ... (cuelga la pestaña).
// Comparar por valor antes de emitir corta el ciclo: solo se avisa cuando el
// rango realmente cambió (navegar de mes), no cuando solo cambió qué celdas
// están deshabilitadas dentro del mismo rango.
let lastEmittedRange: { from: string; to: string } | null = null;
watch(
  weeks,
  (w) => {
    if (w.length === 0) return;
    const range = { from: w[0][0].iso, to: w[w.length - 1][6].iso };
    if (lastEmittedRange && lastEmittedRange.from === range.from && lastEmittedRange.to === range.to) return;
    lastEmittedRange = range;
    emit("visible-range-change", range);
  },
  { immediate: true },
);

function pick(cell: Cell): void {
  if (cell.disabled) return;
  emit("update:modelValue", cell.iso);
}

function prevMonth(): void {
  viewMonth.value = viewMonth.value.minus({ months: 1 });
}
function nextMonth(): void {
  viewMonth.value = viewMonth.value.plus({ months: 1 });
}

const monthLabel = computed(() => viewMonth.value.setLocale("es").toFormat("LLLL yyyy"));
const weekdayLabels = ["L", "M", "M", "J", "V", "S", "D"];
</script>

<template>
  <div class="rounded-lg border border-slate-300 p-3">
    <div class="mb-2 flex items-center justify-between">
      <button
        type="button"
        class="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
        aria-label="Mes anterior"
        @click="prevMonth"
      >
        ‹
      </button>
      <span class="text-sm font-medium text-slate-700 capitalize">{{ monthLabel }}</span>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
        aria-label="Mes siguiente"
        @click="nextMonth"
      >
        ›
      </button>
    </div>
    <div class="grid grid-cols-7 gap-1 pb-1 text-center text-xs text-slate-400">
      <span v-for="(w, i) in weekdayLabels" :key="i">{{ w }}</span>
    </div>
    <div v-for="(week, wi) in weeks" :key="wi" class="grid grid-cols-7 gap-1">
      <button
        v-for="cell in week"
        :key="cell.iso"
        type="button"
        :disabled="cell.disabled"
        class="rounded-md py-1.5 text-xs"
        :class="[
          !cell.inMonth ? 'text-slate-300' : cell.disabled ? 'cursor-not-allowed text-slate-300' : 'text-slate-700 hover:bg-brand-50',
          cell.iso === modelValue ? '!bg-brand-700 !text-white' : '',
          cell.iso === todayIso && cell.iso !== modelValue ? 'border border-brand-300' : '',
        ]"
        @click="pick(cell)"
      >
        {{ cell.day }}
      </button>
    </div>
  </div>
</template>
