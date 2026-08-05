<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { reportsForRole } from "@/lib/reports/registry";
import { resolveRole } from "@/lib/reports/filters";
import ReportIcon from "@/components/reports/ReportIcon.vue";

const auth = useAuthStore();

const role = computed(() => resolveRole(auth.isAdmin, auth.isReceptionist));
const reports = computed(() => reportsForRole(role.value));

const alcance = computed(() =>
  role.value === "medico"
    ? "Los reportes muestran únicamente sus propias citas."
    : "Los reportes cubren toda la clínica y se pueden desglosar por especialidad o por médico.",
);
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="font-display text-xl font-bold text-brand-800">Reportes</h1>
      <p class="mt-1 text-sm text-slate-500">{{ alcance }}</p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <RouterLink
        v-for="report in reports"
        :key="report.id"
        :to="{ name: 'reporte', params: { reportId: report.id } }"
        class="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow-md"
      >
        <span
          class="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 transition group-hover:bg-brand-100"
        >
          <span class="h-5 w-5"><ReportIcon :name="report.icon" /></span>
        </span>
        <h2 class="font-display text-sm font-semibold text-brand-800">{{ report.title }}</h2>
        <p class="mt-1 text-xs leading-relaxed text-slate-500">{{ report.description }}</p>
      </RouterLink>
    </div>
  </div>
</template>
