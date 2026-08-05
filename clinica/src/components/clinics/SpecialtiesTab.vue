<script setup lang="ts">
import { ref } from "vue";
import type { SpecialtyRow } from "@/lib/directus";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";
import SpecialtyFormModal from "@/components/clinics/SpecialtyFormModal.vue";

const props = defineProps<{ clinicId: string; specialties: SpecialtyRow[] }>();
const emit = defineEmits<{ changed: [] }>();

const showModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingRow = ref<SpecialtyRow | undefined>(undefined);

function openCreate(): void {
  modalMode.value = "create";
  editingRow.value = undefined;
  showModal.value = true;
}

function openEdit(row: SpecialtyRow): void {
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
    <div class="mb-4 flex justify-end">
      <Button size="sm" @click="openCreate">+ Agregar especialidad</Button>
    </div>

    <ul v-if="specialties.length > 0" class="divide-y divide-slate-100">
      <li v-for="s in specialties" :key="s.id" class="flex items-center justify-between gap-3 py-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="truncate text-sm font-medium text-slate-700">{{ s.nombre }}</span>
          <Badge :tone="s.activo ? 'success' : 'neutral'">{{ s.activo ? "Activa" : "Inactiva" }}</Badge>
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
    <EmptyState v-else title="Sin especialidades" description="Agregá al menos una para poder cargar médicos y servicios." />

    <SpecialtyFormModal
      v-if="showModal"
      :clinic-id="props.clinicId"
      :mode="modalMode"
      :row="editingRow"
      @close="showModal = false"
      @saved="handleSaved"
    />
  </div>
</template>
