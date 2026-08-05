<script setup lang="ts">
import EmptyState from "./EmptyState.vue";
import { alignOf, formatCell } from "@/lib/reports/format";
import type { Column } from "@/lib/reports/types";

/**
 * Tabla genérica dirigida por `columns` + `rows`. Extrae el `<table>` que estaba
 * copiado en PatientsView/AppointmentsView/WaitlistView; los reportes habrían
 * sido la cuarta copia. Esas tres vistas siguen con la suya (migrarlas es otro
 * cambio), así que las clases de acá son las mismas para que no se note el salto.
 */
withDefaults(
  defineProps<{
    columns: Column[];
    rows: Record<string, unknown>[];
    emptyTitle?: string;
    emptyDescription?: string;
    /** Ancho mínimo antes de hacer scroll horizontal. Se escala con el nº de columnas. */
    minWidth?: number;
  }>(),
  { emptyTitle: "Sin datos", emptyDescription: "No hay información para los filtros elegidos." },
);
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <EmptyState v-if="rows.length === 0" :title="emptyTitle" :description="emptyDescription" />
    <!-- El scroll vive acá dentro y no en el body: la página nunca debe desplazarse
         en horizontal, sobre todo en móvil. -->
    <div v-else class="overflow-x-auto">
      <table class="w-full text-left text-sm" :style="{ minWidth: `${minWidth ?? Math.max(420, columns.length * 130)}px` }">
        <thead class="border-b border-slate-200 bg-slate-50">
          <tr>
            <th
              v-for="col in columns"
              :key="col.key"
              class="px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"
              :class="alignOf(col) === 'right' ? 'text-right' : 'text-left'"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="(row, i) in rows" :key="i" class="transition hover:bg-slate-50">
            <td
              v-for="col in columns"
              :key="col.key"
              class="px-4 py-2.5 text-slate-600"
              :class="alignOf(col) === 'right' ? 'text-right tabular-nums' : 'text-left'"
            >
              {{ formatCell(row[col.key], col.format) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
