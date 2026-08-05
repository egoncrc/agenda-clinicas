<script setup lang="ts">
import { computed, ref } from "vue";
import type { ServiceRow, SpecialtyRow } from "@/lib/directus";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";
import ServiceFormModal from "@/components/clinics/ServiceFormModal.vue";

const props = defineProps<{ clinicId: string; services: ServiceRow[]; specialties: SpecialtyRow[] }>();
const emit = defineEmits<{ changed: [] }>();

const showModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingRow = ref<ServiceRow | undefined>(undefined);

function specialtyName(id: string): string {
  return props.specialties.find((s) => s.id === id)?.nombre ?? "(especialidad)";
}

const canCreate = computed(() => props.specialties.length > 0);

function openCreate(): void {
  modalMode.value = "create";
  editingRow.value = undefined;
  showModal.value = true;
}

function openEdit(row: ServiceRow): void {
  modalMode.value = "edit";
  editingRow.value = row;
  showModal.value = true;
}

function handleSaved(): void {
  showModal.value = false;
  emit("changed");
}
</script>

<template>
  <div>
    <div class="mb-4 flex flex-col items-end gap-1">
      <Button size="sm" :disabled="!canCreate" @click="openCreate">+ Agregar servicio</Button>
      <p v-if="!canCreate" class="text-xs text-amber-600">Agregá primero una especialidad.</p>
    </div>

    <ul v-if="services.length > 0" class="divide-y divide-slate-100">
      <li v-for="s in services" :key="s.id" class="flex items-center justify-between gap-3 py-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="truncate text-sm font-medium text-slate-700">{{ s.nombre }}</span>
          <span class="text-xs text-slate-400">{{ specialtyName(s.specialty) }} · {{ s.duracion_min }}min</span>
          <Badge :tone="s.activo ? 'success' : 'neutral'">{{ s.activo ? "Activo" : "Inactivo" }}</Badge>
        </div>
        <button
          type="button"
          class="flex h-7 w-7 flex-none items-center justify-center rounded text-brand-600 hover:bg-brand-50"
          aria-label="Editar"
          @click="openEdit(s)"
        >
          <span class="h-4 w-4"><ActionIcon name="edit" /></span>
        </button>
      </li>
    </ul>
    <EmptyState v-else title="Sin servicios" description="Agregá el primero con el botón de arriba." />

    <ServiceFormModal
      v-if="showModal"
      :clinic-id="props.clinicId"
      :mode="modalMode"
      :row="editingRow"
      :specialties="props.specialties"
      @close="showModal = false"
      @saved="handleSaved"
    />
  </div>
</template>
