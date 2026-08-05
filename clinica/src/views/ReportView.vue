<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useClinicaStore } from "@/stores/clinica";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { getReport } from "@/lib/reports/registry";
import { buildReportContext } from "@/lib/reports/context";
import { defaultFilters, describeRange, resolveRole } from "@/lib/reports/filters";
import type { ReportContext, ReportFilters, ReportResult, ReportSection } from "@/lib/reports/types";
import { buildExportMeta, exportFilename } from "@/lib/export/download";
import Button from "@/components/ui/Button.vue";
import Card from "@/components/ui/Card.vue";
import StatCard from "@/components/StatCard.vue";
import DataTable from "@/components/ui/DataTable.vue";
import BarChart from "@/components/ui/BarChart.vue";
import LineChart from "@/components/ui/LineChart.vue";
import DonutChart from "@/components/ui/DonutChart.vue";
import ReportFilterBar from "@/components/reports/ReportFilterBar.vue";

/**
 * Renderizador único de reportes. NO CONOCE NINGÚN REPORTE: resuelve la
 * definición del registro por el parámetro de la ruta y pinta lo que devuelve
 * `run()`. Eso es lo que hace que agregar un reporte no cueste una pantalla
 * nueva ni código de exportación nuevo.
 */
const route = useRoute();
const auth = useAuthStore();
const clinica = useClinicaStore();

const role = computed(() => resolveRole(auth.isAdmin, auth.isReceptionist));
const report = computed(() => getReport(String(route.params.reportId)));

const filters = ref<ReportFilters>(
  defaultFilters(clinica.activeClinicId, role.value, auth.ownDoctorId),
);
const result = ref<ReportResult | null>(null);
const ctx = ref<ReportContext | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const exporting = ref<"pdf" | "xlsx" | null>(null);

/**
 * Sedes a consultar. `clinicId: null` significa "todas las que el usuario puede
 * ver", y la lista del store ya viene recortada por las policies de Directus.
 */
const clinicIds = computed<string[]>(() => {
  if (filters.value.clinicId) return [filters.value.clinicId];
  const todas = clinica.clinics.map((c) => c.id);
  return todas.length > 0 ? todas : clinica.activeClinicId ? [clinica.activeClinicId] : [];
});

const ownDoctorName = computed(() =>
  auth.ownDoctorId ? (ctx.value?.doctorName(auth.ownDoctorId) ?? null) : null,
);

// Guarda contra corridas superpuestas: cambiar tres filtros seguidos dispara tres
// consultas, y sin esto la más lenta puede pisar a la más reciente.
let corrida = 0;

async function load(): Promise<void> {
  const def = report.value;
  if (!def) return;
  if (clinicIds.value.length === 0) return;

  const mia = ++corrida;
  loading.value = true;
  error.value = null;
  try {
    const contexto = await buildReportContext(clinicIds.value);
    const data = await def.run({ ...filters.value }, contexto);
    if (mia !== corrida) return; // llegó tarde: ya hay una consulta más nueva
    ctx.value = contexto;
    result.value = data;
  } catch (e) {
    if (mia !== corrida) return;
    error.value = friendlyErrorMessage(e, "No se pudo generar el reporte.");
    result.value = null;
  } finally {
    if (mia === corrida) loading.value = false;
  }
}

onMounted(load);
// Recalcular al cambiar de filtros o de reporte, sin borrar la tabla anterior
// mientras llega la nueva (`loading` se muestra en la barra de filtros).
watch(filters, load, { deep: true });
watch(
  () => route.params.reportId,
  () => {
    result.value = null;
    filters.value = defaultFilters(clinica.activeClinicId, role.value, auth.ownDoctorId);
    load();
  },
);

/** Los filtros aplicados, en texto, para el encabezado del PDF y la hoja de Excel. */
function filterLines(): string[] {
  const f = filters.value;
  const c = ctx.value;
  const lines: string[] = [];
  lines.push(
    `Sede: ${f.clinicId ? (c?.clinicName(f.clinicId) ?? "—") : clinica.clinics.length > 1 ? "Todas" : (clinica.activeClinic?.nombre ?? "—")}`,
  );
  if (report.value?.filters.includes("doctorId")) {
    lines.push(`Médico: ${f.doctorId ? (c?.doctorName(f.doctorId) ?? "—") : "Todos"}`);
  }
  if (report.value?.filters.includes("specialtyId")) {
    lines.push(`Especialidad: ${f.specialtyId ? (c?.specialtyName(f.specialtyId) ?? "—") : "Todas"}`);
  }
  if (report.value?.filters.includes("serviceId")) {
    lines.push(`Servicio: ${f.serviceId ? (c?.serviceName(f.serviceId) ?? "—") : "Todos"}`);
  }
  return lines;
}

async function exportar(formato: "pdf" | "xlsx"): Promise<void> {
  if (!result.value || !report.value) return;
  exporting.value = formato;
  error.value = null;
  try {
    const meta = buildExportMeta(
      report.value.id,
      report.value.title,
      filters.value.clinicId
        ? (ctx.value?.clinicName(filters.value.clinicId) ?? "Clínica")
        : (clinica.activeClinic?.nombre ?? "Todas las sedes"),
      describeRange(filters.value),
      filterLines(),
    );
    const filename = exportFilename(report.value.id, filters.value, formato);
    // Import dinámico también acá: así el exportador que no se usa nunca se baja.
    if (formato === "pdf") {
      const { exportToPdf } = await import("@/lib/export/toPdf");
      await exportToPdf(result.value, meta, filename);
    } else {
      const { exportToExcel } = await import("@/lib/export/toExcel");
      await exportToExcel(result.value, meta, filename);
    }
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo generar el archivo.");
  } finally {
    exporting.value = null;
  }
}

function chartLabels(section: ReportSection): string[] {
  const key = section.labelKey ?? section.columns[0]?.key ?? "";
  return section.rows.map((r) => String(r[key] ?? ""));
}
function chartValues(section: ReportSection, which: 1 | 2 = 1): number[] {
  const key =
    which === 2 ? section.valueKey2 : (section.valueKey ?? section.columns[1]?.key ?? "");
  if (!key) return [];
  return section.rows.map((r) => Number(r[key] ?? 0));
}
function seriesLabel(section: ReportSection, which: 1 | 2 = 1): string {
  const key = which === 2 ? section.valueKey2 : section.valueKey;
  return section.columns.find((c) => c.key === key)?.label ?? "Serie";
}

const rangeLabel = computed(() => describeRange(filters.value));
</script>

<template>
  <div v-if="!report">
    <h1 class="font-display text-xl font-bold text-brand-800">Reporte no encontrado</h1>
    <p class="mt-2 text-sm text-slate-500">
      Ese reporte no existe o cambió de nombre.
      <RouterLink to="/reportes" class="text-brand-700 underline">Ver todos los reportes</RouterLink>.
    </p>
  </div>

  <div v-else>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <RouterLink to="/reportes" class="text-xs text-slate-400 transition hover:text-brand-700">
          ← Reportes
        </RouterLink>
        <h1 class="font-display text-xl font-bold text-brand-800">{{ report.title }}</h1>
        <p class="mt-1 text-sm text-slate-500">{{ rangeLabel }}</p>
      </div>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          :disabled="!result || loading"
          :loading="exporting === 'xlsx'"
          @click="exportar('xlsx')"
        >
          Excel
        </Button>
        <Button
          variant="secondary"
          size="sm"
          :disabled="!result || loading"
          :loading="exporting === 'pdf'"
          @click="exportar('pdf')"
        >
          PDF
        </Button>
      </div>
    </div>

    <ReportFilterBar
      v-model="filters"
      :visible="report.filters"
      :role="role"
      :own-doctor-name="ownDoctorName"
      :doctors="ctx?.doctors ?? []"
      :specialties="ctx?.specialties ?? []"
      :services="ctx?.services ?? []"
      :loading="loading"
    />

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-if="loading && !result" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      Generando el reporte…
    </div>

    <div v-else-if="result" class="space-y-6">
      <div
        v-if="result.kpis.length > 0"
        class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        <StatCard
          v-for="kpi in result.kpis"
          :key="kpi.label"
          :label="kpi.label"
          :value="kpi.value"
          :hint="kpi.hint"
          :tone="kpi.tone"
        />
      </div>

      <Card v-for="section in result.sections" :key="section.id" :title="section.title">
        <DataTable
          v-if="section.view === 'table'"
          :columns="section.columns"
          :rows="section.rows"
          empty-description="No hay datos para los filtros elegidos."
        />
        <BarChart
          v-else-if="section.view === 'bar'"
          :labels="chartLabels(section)"
          :values="chartValues(section)"
        />
        <DonutChart
          v-else-if="section.view === 'donut'"
          :labels="chartLabels(section)"
          :values="chartValues(section)"
        />
        <LineChart
          v-else-if="section.view === 'line'"
          :labels="chartLabels(section)"
          :values="chartValues(section)"
          :values2="section.valueKey2 ? chartValues(section, 2) : undefined"
          :series-label="seriesLabel(section)"
          :series-label2="section.valueKey2 ? seriesLabel(section, 2) : undefined"
        />

        <!-- Los gráficos van acompañados de su tabla: el gráfico da la forma, la
             tabla da las cifras exactas, y además es lo que se exporta. -->
        <details v-if="section.view !== 'table'" class="mt-4">
          <summary class="cursor-pointer text-xs text-slate-500 transition hover:text-brand-700">
            Ver los datos
          </summary>
          <div class="mt-3">
            <DataTable :columns="section.columns" :rows="section.rows" />
          </div>
        </details>

        <p v-if="section.note" class="mt-3 text-xs text-slate-400">{{ section.note }}</p>
      </Card>

      <div v-if="result.notes?.length" class="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Cómo leer este reporte
        </p>
        <ul class="space-y-1.5">
          <li v-for="(note, i) in result.notes" :key="i" class="flex gap-2 text-xs text-slate-500">
            <span class="text-slate-300">•</span>
            <span>{{ note }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
