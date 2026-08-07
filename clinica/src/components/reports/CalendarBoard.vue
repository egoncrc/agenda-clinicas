<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { DateTime, Interval } from "luxon";
import { CLINIC_TIMEZONE, eachDay, formatDay } from "@/lib/dateRanges";
import { ESTADO_LABELS, ESTADO_TONE } from "@/lib/appointmentStatus";
import type { AppointmentStatus } from "@/lib/directus";
import type { Column, DatePreset } from "@/lib/reports/types";
import DataTable from "@/components/ui/DataTable.vue";

/**
 * Grilla visual de citas. Sin librería, mismo espíritu hecho-a-mano que
 * BarChart/DonutChart/LineChart (SVG) y el algoritmo de semanas de
 * DatePicker.vue. Recibe las filas YA resueltas a nombres por
 * `definitions/calendar.ts` — no consulta Directus.
 */
interface CalendarRow {
  id: string;
  inicio: string;
  fin: string;
  doctorId: string;
  medico: string;
  especialidad: string;
  servicio: string;
  paciente: string;
  estado: string;
  estadoRaw: AppointmentStatus;
}

const props = defineProps<{
  rows: Record<string, unknown>[];
  preset: DatePreset;
  desde: string;
  hasta: string;
}>();

const filas = computed<CalendarRow[]>(() =>
  props.rows.map((r) => ({
    id: String(r.id),
    inicio: String(r.inicio),
    fin: String(r.fin),
    doctorId: String(r.doctorId),
    medico: String(r.medico),
    especialidad: String(r.especialidad),
    servicio: String(r.servicio),
    paciente: String(r.paciente),
    estado: String(r.estado),
    estadoRaw: r.estadoRaw as AppointmentStatus,
  })),
);

/** "Personalizado" no llega acá (definitions/calendar.ts lo resuelve como tabla simple); si llegara, se ve como mes. */
const vista = computed<"dia" | "semana" | "mes">(() => {
  if (props.preset === "hoy") return "dia";
  if (props.preset === "semana") return "semana";
  return "mes";
});

function ymd(iso: string): string {
  return DateTime.fromISO(iso, { zone: CLINIC_TIMEZONE }).toFormat("yyyy-LL-dd");
}
function formatHora(iso: string): string {
  return DateTime.fromISO(iso, { zone: CLINIC_TIMEZONE }).toFormat("HH:mm");
}

const TONE_BLOCK_CLASSES: Record<string, string> = {
  success: "bg-emerald-50 border-emerald-400 text-emerald-800",
  warn: "bg-amber-50 border-amber-400 text-amber-800",
  danger: "bg-red-50 border-red-400 text-red-800",
  neutral: "bg-slate-100 border-slate-400 text-slate-600",
};
const LEYENDA_DOT: Record<string, string> = {
  success: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-slate-400",
};

// ---------------------------------------------------------------------------
// Vista Día: columnas por médico. Un médico no puede tener dos citas que se
// solapen (lo impide el motor de disponibilidad y, por si acaso, el hook
// appointments-overlap-guard de Directus — ver CLAUDE.md), así que dentro de
// una misma columna es seguro posicionar los bloques por horario sin chocar.
// ---------------------------------------------------------------------------
const PX_POR_HORA = 48;
const ALTURA_MIN_BLOQUE = 20;
const VENTANA_DEFECTO = { inicio: 7, fin: 20 };

/** Ventana horaria visible: se ajusta a las citas reales, con 07:00–20:00 como piso. */
const ventana = computed(() => {
  if (filas.value.length === 0) return VENTANA_DEFECTO;
  let inicio = VENTANA_DEFECTO.inicio;
  let fin = VENTANA_DEFECTO.fin;
  for (const c of filas.value) {
    const ini = DateTime.fromISO(c.inicio, { zone: CLINIC_TIMEZONE });
    const term = DateTime.fromISO(c.fin, { zone: CLINIC_TIMEZONE });
    if (ini.isValid) inicio = Math.min(inicio, ini.hour);
    if (term.isValid) fin = Math.max(fin, term.minute > 0 ? term.hour + 1 : term.hour);
  }
  return { inicio, fin: Math.max(fin, inicio + 1) };
});
const alturaTotal = computed(() => (ventana.value.fin - ventana.value.inicio) * PX_POR_HORA);
const horasEtiquetas = computed(() => {
  const out: number[] = [];
  for (let h = ventana.value.inicio; h <= ventana.value.fin; h++) out.push(h);
  return out;
});

function estiloBloque(c: CalendarRow): { top: string; height: string } {
  const ini = DateTime.fromISO(c.inicio, { zone: CLINIC_TIMEZONE });
  const term = DateTime.fromISO(c.fin, { zone: CLINIC_TIMEZONE });
  const minutosDesdeInicio = ini.isValid ? Math.max(0, (ini.hour - ventana.value.inicio) * 60 + ini.minute) : 0;
  const duracionMin = ini.isValid && term.isValid ? Math.max(0, term.diff(ini, "minutes").minutes) : 30;
  return {
    top: `${(minutosDesdeInicio / 60) * PX_POR_HORA}px`,
    height: `${Math.max(ALTURA_MIN_BLOQUE, (duracionMin / 60) * PX_POR_HORA)}px`,
  };
}

const columnasDia = computed(() => {
  const porMedico = new Map<string, { nombre: string; citas: CalendarRow[] }>();
  for (const c of filas.value) {
    const entry = porMedico.get(c.doctorId) ?? { nombre: c.medico, citas: [] };
    entry.citas.push(c);
    porMedico.set(c.doctorId, entry);
  }
  // Alfabético ascendente: mismo orden de lectura que el resto de Reportes.
  return [...porMedico.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
});

// ---------------------------------------------------------------------------
// Vista Semana: 7 columnas por día. Acá SÍ puede haber solapes (dos médicos
// distintos atendiendo a la misma hora), así que en vez de posicionar por
// horario se lista cronológicamente — más simple y sin riesgo de que un
// bloque tape a otro.
// ---------------------------------------------------------------------------
const diasSemana = computed(() => {
  if (vista.value !== "semana") return [];
  const desde = DateTime.fromISO(props.desde, { zone: CLINIC_TIMEZONE }).startOf("day");
  const hasta = DateTime.fromISO(props.hasta, { zone: CLINIC_TIMEZONE }).startOf("day");
  return eachDay(Interval.fromDateTimes(desde, hasta)).map((d) => {
    const iso = d.toFormat("yyyy-LL-dd");
    return {
      iso,
      etiqueta: d.setLocale("es").toFormat("ccc d"),
      citas: filas.value.filter((c) => ymd(c.inicio) === iso).sort((a, b) => a.inicio.localeCompare(b.inicio)),
    };
  });
});

// ---------------------------------------------------------------------------
// Vista Mes: grid de semanas, mismo algoritmo que DatePicker.vue (`weeks`).
// Cada celda es un contador, no bloques individuales: con 30 días en pantalla
// no hay espacio para leer una cita, así que el detalle se ve abajo al
// seleccionar un día.
// ---------------------------------------------------------------------------
const diaSeleccionado = ref<string | null>(null);

// Al navegar a otro mes, el día elegido queda fuera de la grilla y su tabla de
// detalle sale vacía sin que nada lo explique.
watch(
  () => props.desde,
  () => {
    diaSeleccionado.value = null;
  },
);

const semanasMes = computed(() => {
  if (vista.value !== "mes") return [];
  const inicioMes = DateTime.fromISO(props.desde, { zone: CLINIC_TIMEZONE }).startOf("day");
  const finMes = DateTime.fromISO(props.hasta, { zone: CLINIC_TIMEZONE }).startOf("day");
  const dias = eachDay(Interval.fromDateTimes(inicioMes.startOf("week"), finMes.endOf("week")));
  const celdas = dias.map((d) => {
    const iso = d.toFormat("yyyy-LL-dd");
    return {
      iso,
      dia: d.day,
      enMes: d.hasSame(inicioMes, "month"),
      citas: filas.value.filter((c) => ymd(c.inicio) === iso),
    };
  });
  const semanas: (typeof celdas)[] = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
});

function celdaClase(citas: CalendarRow[]): string {
  const n = citas.length;
  if (n === 0) return "cursor-default bg-slate-50";
  if (n <= 2) return "cursor-pointer bg-brand-50 hover:bg-brand-100";
  if (n <= 5) return "cursor-pointer bg-brand-100 hover:bg-brand-200";
  return "cursor-pointer bg-brand-200 hover:bg-brand-300";
}

function seleccionarDia(iso: string, citas: CalendarRow[]): void {
  if (citas.length === 0) return;
  diaSeleccionado.value = diaSeleccionado.value === iso ? null : iso;
}

const COLUMNAS_DETALLE: Column[] = [
  { key: "horaLabel", label: "Hora" },
  { key: "medico", label: "Médico" },
  { key: "especialidad", label: "Especialidad" },
  { key: "servicio", label: "Servicio" },
  { key: "paciente", label: "Paciente" },
  { key: "estado", label: "Estado" },
];

const citasDelDiaSeleccionado = computed(() => {
  if (!diaSeleccionado.value) return [];
  return filas.value
    .filter((c) => ymd(c.inicio) === diaSeleccionado.value)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .map((c) => ({ ...c, horaLabel: formatHora(c.inicio) }));
});

const etiquetaDiaSeleccionado = computed(() => {
  if (!diaSeleccionado.value) return "";
  const dt = DateTime.fromFormat(diaSeleccionado.value, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
  return dt.isValid ? formatDay(dt.toJSDate()) : "";
});
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap gap-3 text-xs text-slate-500">
      <span v-for="(tone, estado) in ESTADO_TONE" :key="estado" class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-full" :class="LEYENDA_DOT[tone]" />
        {{ ESTADO_LABELS[estado as AppointmentStatus] }}
      </span>
    </div>

    <div v-if="filas.length === 0" class="py-10 text-center text-sm text-slate-400">
      No hay citas para este período.
    </div>

    <!-- Día -->
    <div v-else-if="vista === 'dia'" class="overflow-x-auto">
      <div class="flex" :style="{ minWidth: `${80 + columnasDia.length * 180}px` }">
        <div class="w-12 shrink-0">
          <div class="h-7" />
          <div class="relative" :style="{ height: `${alturaTotal}px` }">
            <span
              v-for="h in horasEtiquetas"
              :key="h"
              class="absolute -translate-y-1/2 text-[10px] text-slate-400"
              :style="{ top: `${(h - ventana.inicio) * PX_POR_HORA}px` }"
            >
              {{ String(h).padStart(2, "0") }}:00
            </span>
          </div>
        </div>
        <div v-for="col in columnasDia" :key="col.nombre" class="min-w-[180px] flex-1 border-l border-slate-100 px-1.5">
          <div class="h-7 truncate text-xs font-semibold text-slate-600" :title="col.nombre">{{ col.nombre }}</div>
          <div class="relative border-t border-slate-100" :style="{ height: `${alturaTotal}px` }">
            <div
              v-for="h in horasEtiquetas"
              :key="h"
              class="absolute inset-x-0 border-t border-slate-100"
              :style="{ top: `${(h - ventana.inicio) * PX_POR_HORA}px` }"
            />
            <div
              v-for="c in col.citas"
              :key="c.id"
              class="absolute inset-x-0.5 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-[11px] leading-tight"
              :class="TONE_BLOCK_CLASSES[ESTADO_TONE[c.estadoRaw]]"
              :style="estiloBloque(c)"
              :title="`${formatHora(c.inicio)} · ${c.paciente} · ${c.servicio} · ${c.estado}`"
            >
              <span class="font-semibold">{{ formatHora(c.inicio) }}</span> {{ c.paciente }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Semana -->
    <div v-else-if="vista === 'semana'" class="overflow-x-auto">
      <div class="grid grid-cols-7 gap-2" style="min-width: 840px">
        <div v-for="dia in diasSemana" :key="dia.iso" class="min-h-[120px] rounded-lg border border-slate-100 p-2">
          <div class="mb-1.5 text-xs font-semibold text-slate-600 capitalize">{{ dia.etiqueta }}</div>
          <div class="space-y-1">
            <div
              v-for="c in dia.citas"
              :key="c.id"
              class="rounded-md border-l-4 px-1.5 py-1 text-[11px] leading-tight"
              :class="TONE_BLOCK_CLASSES[ESTADO_TONE[c.estadoRaw]]"
              :title="`${c.medico} · ${c.paciente} · ${c.servicio} · ${c.estado}`"
            >
              <span class="font-semibold">{{ formatHora(c.inicio) }}</span> {{ c.medico }}
              <div class="truncate text-slate-500">{{ c.paciente }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mes -->
    <div v-else>
      <div class="grid grid-cols-7 gap-1 pb-1 text-center text-xs text-slate-400">
        <span v-for="(w, i) in ['L', 'M', 'M', 'J', 'V', 'S', 'D']" :key="i">{{ w }}</span>
      </div>
      <div v-for="(semana, wi) in semanasMes" :key="wi" class="grid grid-cols-7 gap-1">
        <button
          v-for="celda in semana"
          :key="celda.iso"
          type="button"
          class="aspect-square rounded-md p-1.5 text-left text-xs transition"
          :class="[
            celdaClase(celda.citas),
            !celda.enMes ? 'opacity-40' : '',
            celda.iso === diaSeleccionado ? 'ring-2 ring-brand-600' : '',
          ]"
          :disabled="celda.citas.length === 0"
          @click="seleccionarDia(celda.iso, celda.citas)"
        >
          <div class="text-slate-600">{{ celda.dia }}</div>
          <div v-if="celda.citas.length > 0" class="mt-1 font-semibold text-slate-700">{{ celda.citas.length }}</div>
        </button>
      </div>

      <div v-if="diaSeleccionado" class="mt-4">
        <p class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase capitalize">
          Citas del {{ etiquetaDiaSeleccionado }}
        </p>
        <DataTable :columns="COLUMNAS_DETALLE" :rows="citasDelDiaSeleccionado" />
      </div>
    </div>
  </div>
</template>
