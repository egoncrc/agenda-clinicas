<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { readItems, updateItem } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { PatientRow } from "@/lib/directus";
import { useAuthStore } from "@/stores/auth";
import { useClinicaStore } from "@/stores/clinica";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useConfirm } from "@/composables/useConfirm";
import PatientFormModal from "@/components/PatientFormModal.vue";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";

const auth = useAuthStore();
const clinica = useClinicaStore();
const confirm = useConfirm();

/** Tope de filas por consulta: la lista no pagina, se refina con el buscador. */
const PAGE_LIMIT = 200;

const search = ref("");
const estadoFilter = ref<"activos" | "inactivos" | "todos">("activos");

const patients = ref<PatientRow[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const showModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingPatient = ref<PatientRow | undefined>(undefined);

let loadInFlight = false;

async function load(opts: { silent?: boolean } = {}): Promise<void> {
  if (loadInFlight) return;
  loadInFlight = true;
  if (!opts.silent) loading.value = true;
  error.value = null;
  try {
    const filter: Record<string, unknown> = { clinic: { _eq: clinica.activeClinicId ?? undefined } };
    // `_neq: false` en vez de `_eq: true`: una fila creada fuera del panel puede
    // tener `activo` en NULL y no por eso está dada de baja.
    if (estadoFilter.value === "activos") filter.activo = { _neq: false };
    else if (estadoFilter.value === "inactivos") filter.activo = { _eq: false };

    const query = search.value.trim();
    if (query) {
      filter._or = [
        { nombre: { _icontains: query } },
        { telefono: { _contains: query } },
        { identificacion: { _icontains: query } },
        { correo: { _icontains: query } },
      ];
    }

    patients.value = await directus.request(
      readItems("patients", { filter, sort: ["nombre"], limit: PAGE_LIMIT }),
    );
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudieron cargar los pacientes.");
  } finally {
    if (!opts.silent) loading.value = false;
    loadInFlight = false;
  }
}

/** El buscador consulta a Directus, así que espera a que la recepcionista deje de escribir. */
const SEARCH_DEBOUNCE_MS = 300;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), SEARCH_DEBOUNCE_MS);
});
watch(estadoFilter, () => load());

onMounted(() => load());
onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

function openCreate(): void {
  modalMode.value = "create";
  editingPatient.value = undefined;
  showModal.value = true;
}

function openEdit(p: PatientRow): void {
  modalMode.value = "edit";
  editingPatient.value = p;
  showModal.value = true;
}

async function handleSaved(): Promise<void> {
  showModal.value = false;
  await load({ silent: true });
}

function ubicacion(p: PatientRow): string {
  return [p.distrito, p.canton, p.provincia].filter(Boolean).join(", ") || "—";
}

/**
 * Baja lógica, nunca borrado: `appointments`, `messages` y `waitlist` apuntan
 * al paciente con ON DELETE CASCADE, así que borrarlo se llevaría su historial
 * completo. Solo administrador (Directus además se lo niega a recepción: su
 * permiso de update no incluye el campo `activo`).
 */
async function toggleActivo(p: PatientRow): Promise<void> {
  const darDeBaja = p.activo !== false;
  const ok = await confirm({
    title: darDeBaja ? "Dar de baja al paciente" : "Reactivar al paciente",
    message: darDeBaja
      ? "Dejará de aparecer en el listado y no se podrá agendar ni por el panel ni por WhatsApp. Su historial de citas y mensajes se conserva y la baja se puede revertir."
      : "Volverá a aparecer en el listado y se le podrán agendar citas.",
    confirmLabel: darDeBaja ? "Dar de baja" : "Reactivar",
    // `tone` no tiene variante neutra y su default es "danger": reactivar no
    // destruye nada, así que va en "warn" para no pintar de rojo el botón.
    tone: darDeBaja ? "danger" : "warn",
  });
  if (!ok) return;
  try {
    await directus.request(updateItem("patients", p.id, { activo: !darDeBaja }));
    await load({ silent: true });
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo cambiar el estado del paciente.");
  }
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 class="font-display text-xl font-bold text-brand-800">Pacientes</h1>
      <Button @click="openCreate">+ Nuevo paciente</Button>
    </div>

    <p class="mb-4 text-sm text-slate-500">
      Ficha de los pacientes de la clínica. El bot de WhatsApp crea automáticamente a quien escribe por primera vez;
      acá se completan sus datos.
    </p>

    <div class="mb-4 flex flex-wrap gap-3">
      <input
        v-model="search"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-72"
        placeholder="Buscar por nombre, teléfono, identificación o correo"
      />
      <select
        v-model="estadoFilter"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-auto"
      >
        <option value="activos">Activos</option>
        <option value="inactivos">Dados de baja</option>
        <option value="todos">Todos</option>
      </select>
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>
    <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <EmptyState v-if="patients.length === 0" title="No hay pacientes para este filtro" />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50">
            <tr>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Nombre</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Teléfono</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Identificación</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Correo</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Ubicación</th>
              <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</th>
              <th class="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="p in patients" :key="p.id" class="transition hover:bg-slate-50">
              <td class="px-4 py-2.5 text-slate-700">
                {{ p.nombre?.trim() || "(sin nombre)" }}
                <Badge v-if="p.titular" tone="neutral">Titular</Badge>
              </td>
              <td class="px-4 py-2.5 text-slate-600">{{ p.telefono }}</td>
              <td class="px-4 py-2.5 text-slate-600">{{ p.identificacion || "—" }}</td>
              <td class="px-4 py-2.5 text-slate-600">{{ p.correo || "—" }}</td>
              <td class="px-4 py-2.5 text-slate-600">{{ ubicacion(p) }}</td>
              <td class="px-4 py-2.5">
                <Badge :tone="p.activo === false ? 'neutral' : 'success'">
                  {{ p.activo === false ? "Dado de baja" : "Activo" }}
                </Badge>
              </td>
              <td class="px-4 py-2.5">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-brand-700"
                    title="Editar"
                    aria-label="Editar"
                    @click="openEdit(p)"
                  >
                    <span class="h-4 w-4"><ActionIcon name="edit" /></span>
                  </button>
                  <!-- Solo administrador: es UX, el control real es que el permiso
                       de update de recepción no incluye el campo `activo`. -->
                  <button
                    v-if="auth.isAdmin && p.activo !== false"
                    type="button"
                    class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    title="Dar de baja"
                    aria-label="Dar de baja"
                    @click="toggleActivo(p)"
                  >
                    <span class="h-4 w-4"><ActionIcon name="trash" /></span>
                  </button>
                  <button
                    v-else-if="auth.isAdmin"
                    type="button"
                    class="rounded-md px-2 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-50"
                    @click="toggleActivo(p)"
                  >
                    Reactivar
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <p v-if="!loading && !error && patients.length === PAGE_LIMIT" class="mt-3 text-xs text-slate-500">
      Mostrando los primeros {{ PAGE_LIMIT }} pacientes — refiná la búsqueda para ver el resto.
    </p>

    <PatientFormModal
      v-if="showModal"
      :mode="modalMode"
      :row="editingPatient"
      @close="showModal = false"
      @saved="handleSaved"
    />
  </div>
</template>
