<script setup lang="ts">
/**
 * Lista TODAS las clínicas (incl. inactivas) — no usa `useClinicaStore`, que
 * filtra `activo:true` y representa "clínicas entre las que puedo cambiar en
 * esta sesión", no "todas las que administro". Solo llega acá Administrator
 * (ver router meta `adminOnly`), que no tiene scoping de fila en Directus.
 */
import { onMounted, ref } from "vue";
import { readItems } from "@directus/sdk";
import { useRouter } from "vue-router";
import { directus } from "@/lib/directus";
import type { ClinicRow } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import Button from "@/components/ui/Button.vue";
import Card from "@/components/ui/Card.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";

const router = useRouter();
const clinics = ref<ClinicRow[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    clinics.value = await directus.request(readItems("clinics", { sort: ["nombre"], limit: -1 }));
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudieron cargar las clínicas.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 class="font-display text-xl font-bold text-brand-800">Clínicas</h1>
      <Button @click="router.push({ name: 'admin-clinicas-nuevo' })">+ Nueva clínica</Button>
    </div>

    <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>
    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>

    <Card v-else-if="clinics.length > 0">
      <ul class="divide-y divide-slate-100">
        <li v-for="c in clinics" :key="c.id" class="flex items-center justify-between gap-3 py-3">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="truncate text-sm font-medium text-slate-700">{{ c.nombre }}</span>
            <Badge :tone="c.activo ? 'success' : 'neutral'">{{ c.activo ? "Activa" : "Inactiva" }}</Badge>
          </div>
          <Button
            variant="secondary"
            size="sm"
            @click="router.push({ name: 'admin-clinicas-detalle', params: { id: c.id } })"
          >
            Editar
          </Button>
        </li>
      </ul>
    </Card>

    <EmptyState v-else title="Todavía no hay clínicas" description="Creá la primera con el botón de arriba." />
  </div>
</template>
