<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { createItem, readItems, updateItem } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { PatientRow } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useClinicaStore } from "@/stores/clinica";
import { cantones, distritos, provincias, withCurrent } from "@/lib/costaRica";
import Button from "@/components/ui/Button.vue";

const props = defineProps<{
  mode: "create" | "edit";
  row?: PatientRow;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const clinica = useClinicaStore();

const nombre = ref(props.row?.nombre ?? "");
const telefono = ref(props.row?.telefono ?? "");
const identificacion = ref(props.row?.identificacion ?? "");
const correo = ref(props.row?.correo ?? "");
const titular = ref(props.row?.titular ?? true);
const provincia = ref(props.row?.provincia ?? "");
const canton = ref(props.row?.canton ?? "");
const distrito = ref(props.row?.distrito ?? "");
const direccion = ref(props.row?.direccion ?? "");
const notas = ref(props.row?.notas ?? "");

const saving = ref(false);
const error = ref<string | null>(null);

// `withCurrent` deja visible un valor guardado que ya no figura en el catálogo
// (ficha vieja, cantón renombrado, dato cargado a mano en Directus): sin eso el
// `<select>` no podría representarlo y se perdería al guardar.
const provinciaOptions = computed(() => withCurrent(provincias(), provincia.value));
const cantonOptions = computed(() => withCurrent(cantones(provincia.value), canton.value));
const distritoOptions = computed(() => withCurrent(distritos(provincia.value, canton.value), distrito.value));

// Cambiar el nivel de arriba invalida los de abajo. Solo corre ante un cambio
// real del usuario: el modal se monta de cero con los valores de la ficha y un
// `watch` sin `immediate` no dispara en la inicialización.
watch(provincia, () => {
  canton.value = "";
  distrito.value = "";
});
watch(canton, () => {
  distrito.value = "";
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * La identificación no tiene índice único en Directus (el bot crea pacientes
 * solo con teléfono, así que el campo es opcional y se repetiría en vacío).
 * El chequeo vive acá: mismo documento dentro de la misma clínica.
 */
async function identificacionDuplicada(valor: string): Promise<boolean> {
  const filter: Record<string, unknown> = {
    clinic: { _eq: clinica.activeClinicId ?? undefined },
    identificacion: { _eq: valor },
  };
  if (props.row) filter.id = { _neq: props.row.id };
  const existing = await directus.request(
    readItems("patients", { filter, limit: 1, fields: ["id"] }),
  );
  return existing.length > 0;
}

async function handleSubmit(): Promise<void> {
  error.value = null;
  if (!telefono.value.trim()) {
    error.value = "El teléfono es obligatorio.";
    return;
  }
  if (correo.value.trim() && !EMAIL_RE.test(correo.value.trim())) {
    error.value = "El correo no tiene un formato válido.";
    return;
  }
  saving.value = true;
  try {
    const doc = identificacion.value.trim();
    if (doc && (await identificacionDuplicada(doc))) {
      error.value = "Ya existe un paciente con esa identificación en esta clínica.";
      return;
    }

    const payload = {
      nombre: nombre.value.trim() || null,
      telefono: telefono.value.trim(),
      titular: titular.value,
      identificacion: doc || null,
      correo: correo.value.trim() || null,
      provincia: provincia.value || null,
      canton: canton.value || null,
      distrito: distrito.value || null,
      direccion: direccion.value.trim() || null,
      notas: notas.value.trim() || null,
    };

    if (props.mode === "create") {
      await directus.request(
        createItem("patients", { ...payload, activo: true, clinic: clinica.activeClinicId ?? undefined }),
      );
    } else if (props.row) {
      // Sin `activo`: la baja lógica es del administrador y recepción no tiene
      // ese campo en su permiso de update (mandarlo sería un 403).
      await directus.request(updateItem("patients", props.row.id, payload));
    }
    emit("saved");
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo guardar el paciente.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="max-h-full w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-4 text-lg font-bold text-brand-800">
        {{ mode === "create" ? "Nuevo paciente" : "Editar paciente" }}
      </h2>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
          <input
            v-model="nombre"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="María Rodríguez"
          />
        </div>

        <div class="flex gap-3">
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
            <input
              v-model="telefono"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="+50688887777"
            />
          </div>
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Identificación</label>
            <input
              v-model="identificacion"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="1-2345-6789"
            />
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Correo</label>
          <input
            v-model="correo"
            type="email"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="maria@ejemplo.com"
          />
        </div>

        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="titular" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500/30" />
          Titular del teléfono
        </label>
        <p class="-mt-2 text-xs text-slate-500">
          Varias personas pueden compartir un número (ej. un hijo bajo el teléfono del padre); solo una es la titular.
        </p>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Provincia</label>
          <select
            v-model="provincia"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">Sin especificar</option>
            <option v-for="p in provinciaOptions" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>

        <div class="flex gap-3">
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Cantón</label>
            <select
              v-model="canton"
              :disabled="!provincia"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Sin especificar</option>
              <option v-for="c in cantonOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium text-slate-700">Distrito</label>
            <select
              v-model="distrito"
              :disabled="!canton"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Sin especificar</option>
              <option v-for="d in distritoOptions" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Señas exactas</label>
          <textarea
            v-model="direccion"
            rows="2"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="200 m sur de la iglesia, casa color celeste"
          ></textarea>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Notas</label>
          <textarea
            v-model="notas"
            rows="2"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="Alergias, observaciones…"
          ></textarea>
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="secondary" @click="emit('close')">Cancelar</Button>
          <Button type="submit" :loading="saving">{{ saving ? "Guardando…" : "Guardar" }}</Button>
        </div>
      </form>
    </div>
  </div>
</template>
