<script setup lang="ts">
import { ref } from "vue";
import { createItem, updateItem } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { SpecialtyRow } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import Button from "@/components/ui/Button.vue";

const props = defineProps<{
  clinicId: string;
  mode: "create" | "edit";
  row?: SpecialtyRow;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const nombre = ref(props.row?.nombre ?? "");
const activo = ref(props.row?.activo ?? true);
const saving = ref(false);
const error = ref<string | null>(null);

async function handleSubmit(): Promise<void> {
  error.value = null;
  if (!nombre.value.trim()) {
    error.value = "El nombre es obligatorio.";
    return;
  }
  saving.value = true;
  try {
    if (props.mode === "create") {
      await directus.request(
        createItem("specialties", { nombre: nombre.value.trim(), activo: true, clinic: props.clinicId }),
      );
    } else if (props.row) {
      await directus.request(
        updateItem("specialties", props.row.id, { nombre: nombre.value.trim(), activo: activo.value }),
      );
    }
    emit("saved");
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo guardar la especialidad.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-4 text-lg font-bold text-brand-800">
        {{ mode === "create" ? "Agregar especialidad" : "Editar especialidad" }}
      </h2>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
          <input
            v-model="nombre"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="Odontología"
          />
        </div>

        <label v-if="mode === 'edit'" class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="activo" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500/30" />
          Activa
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
