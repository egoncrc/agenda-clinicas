<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { fetchDashboardStats, type DashboardStats } from "@/lib/stats";
import { formatDateTime } from "@/lib/dateRanges";
import StatCard from "@/components/StatCard.vue";
import Card from "@/components/ui/Card.vue";
import EmptyState from "@/components/ui/EmptyState.vue";

const catalog = useCatalogStore();
const clinica = useClinicaStore();
const stats = ref<DashboardStats | null>(null);
const patientNames = ref<Record<string, string>>({});
const loading = ref(true);
const error = ref<string | null>(null);

const maxDoctorCount = computed(() =>
  Math.max(1, ...(stats.value?.porDoctoraHoy.map((d) => d.count) ?? [1])),
);

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    await catalog.load();
    const result = await fetchDashboardStats(clinica.activeClinicId!);
    stats.value = result;

    const patientIds = [...new Set(result.proximasCitas.map((a) => a.patientId))];
    if (patientIds.length > 0) {
      const patients = await directus.request(
        readItems("patients", { filter: { id: { _in: patientIds } }, fields: ["id", "nombre", "telefono"] }),
      );
      patientNames.value = Object.fromEntries(
        patients.map((p) => [p.id, p.nombre?.trim() || p.telefono]),
      );
    }
  } catch {
    error.value = "No se pudieron cargar las estadísticas. Intenta recargar la página.";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="font-display mb-6 text-xl font-bold text-brand-800">Dashboard</h1>

    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>
    <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-else-if="stats" class="space-y-6">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Confirmadas hoy" :value="stats.confirmadasHoy" tone="success" icon="check" />
        <StatCard label="Pendientes hoy" :value="stats.pendientesHoy" tone="warn" icon="clock" />
        <StatCard label="Canceladas hoy" :value="stats.canceladasHoy" tone="danger" icon="x" />
        <StatCard label="Canceladas esta semana" :value="stats.canceladasSemana" tone="danger" icon="x" />
        <StatCard label="No-shows esta semana" :value="stats.noShowsSemana" tone="warn" icon="alert" />
      </div>

      <Card title="Citas de hoy por médico">
        <EmptyState v-if="stats.porDoctoraHoy.length === 0" title="No hay citas activas para hoy" />
        <div v-else class="space-y-3">
          <div v-for="row in stats.porDoctoraHoy" :key="row.doctorId" class="flex items-center gap-3">
            <span class="w-40 shrink-0 truncate text-sm text-slate-600">{{
              catalog.doctorName(row.doctorId)
            }}</span>
            <div class="h-2 flex-1 rounded-full bg-slate-100">
              <div
                class="h-2 rounded-full bg-brand-600 transition-all"
                :style="{ width: `${(row.count / maxDoctorCount) * 100}%` }"
              />
            </div>
            <span class="w-6 shrink-0 text-right text-sm font-medium text-slate-700">{{ row.count }}</span>
          </div>
        </div>
      </Card>

      <Card title="Próximas citas">
        <EmptyState v-if="stats.proximasCitas.length === 0" title="No hay próximas citas" />
        <ul v-else class="divide-y divide-slate-100">
          <li v-for="cita in stats.proximasCitas" :key="cita.id" class="flex items-center gap-3 py-2.5">
            <div
              class="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700"
            >
              {{ initialsOf(patientNames[cita.patientId] ?? "Paciente") }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-slate-800">
                {{ patientNames[cita.patientId] ?? "Paciente" }}
              </p>
              <p class="truncate text-xs text-slate-500">
                {{ catalog.serviceName(cita.serviceId) }} — {{ catalog.doctorName(cita.doctorId) }}
              </p>
            </div>
            <span class="flex-none text-xs font-medium text-slate-600">{{ formatDateTime(cita.inicio) }}</span>
          </li>
        </ul>
      </Card>
    </div>
  </div>
</template>
