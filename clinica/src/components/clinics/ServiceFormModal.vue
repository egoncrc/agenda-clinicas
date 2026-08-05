<script setup lang="ts">
import { ref } from "vue";
import { createItem, updateItem } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { ServiceRow, SpecialtyRow } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import Button from "@/components/ui/Button.vue";

const props = defineProps<{
  clinicId: string;
  mode: "create" | "edit";
  row?: ServiceRow;
  specialties: SpecialtyRow[];
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const nombre = ref(props.row?.nombre ?? "");
const specialty = ref(props.row?.specialty ?? props.specialties[0]?.id ?? "");
const duracionMin = ref(props.row?.duracion_min ?? 30);
const bufferMin = ref(props.row?.buffer_min ?? 0);
const recallMeses = ref<number | null>(props.row?.recall_meses ?? null);
const activo = ref(props.row?.activo ?? true);

const saving = ref(false);
const error = ref<string | null>(null);

async function handleSubmit(): Promise<void> {
  error.value = null;
  if (!nombre.value.trim()) {
    error.value = "El nombre es obligatorio.";
    return;
  }
  if (!specialty.value) {
    error.value = "Elegí una especialidad.";
    return;
  }
  saving.value = true;
  try {
    const payload = {
      nombre: nombre.value.trim(),
      specialty: specialty.value,
      duracion_min: duracionMin.value,
      buffer_min: bufferMin.value,
      recall_meses: recallMeses.value || null,
    };
    if (props.mode === "create") {
      await directus.request(createItem("services", { ...payload, activo: true, clinic: props.clinicId }));
    } else if (props.row) {
      await directus.request(updateItem("services", props.row.id, { ...payload, activo: activo.value }));
    }
    emit("saved");
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo guardar el servicio.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-4 text-lg font-bold text-brand-800">
        {{ mode === "create" ? "Agregar servicio" : "Editar servicio" }}
      </h2>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
          <input
            v-model="nombre"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="Limpieza dental"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Especialidad</label>
          <select
            v-model="specialty"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option v-for="s in specialties" :key="s.id" :value="s.id">{{ s.nombre }}</option>
          </select>
        </div>

        <div class="flex gap-3">
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Duración (min)</label>
            <input
              v-model.number="duracionMin"
              type="number"
              min="1"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Buffer (min)</label>
            <input
              v-model.number="bufferMin"
              type="number"
              min="0"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Recordatorio de seguimiento (meses)</label>
          <input
            v-model.number="recallMeses"
            type="number"
            min="0"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="Vacío = ninguno"
          />
        </div>

        <label v-if="mode === 'edit'" class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="activo" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500/30" />
          Activo
        </label>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="secondary" @click="emit('close')">Cancelar</Button>
          <Button type="submit" :loading="saving">{{ saving ? "Guardando…" : "Guardar" }}</Button>
        </div>
      </form>
    </div>
  </div>
</template>
