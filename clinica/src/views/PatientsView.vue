<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { aggregate, readItems, updateItem } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { PatientRow } from "@/lib/directus";
import { useAuthStore } from "@/stores/auth";
import { useClinicaStore } from "@/stores/clinica";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { clampPage, pageRangeLabel, totalPages as computeTotalPages } from "@/lib/pagination";
import {
  buildPatientFilter,
  DEFAULT_SORT,
  EMPTY_COLUMN_FILTERS,
  nextSort,
  patientSort,
  type EstadoFilter,
  type PatientColumnFilters,
  type PatientSort,
  type PatientSortKey,
} from "@/lib/patientQuery";
import { useConfirm } from "@/composables/useConfirm";
import PatientFormModal from "@/components/PatientFormModal.vue";
import PatientAppointmentsModal from "@/components/PatientAppointmentsModal.vue";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";

const auth = useAuthStore();
const clinica = useClinicaStore();
const confirm = useConfirm();

const search = ref("");
const estadoFilter = ref<EstadoFilter>("activos");
const columnFilters = reactive<PatientColumnFilters>({ ...EMPTY_COLUMN_FILTERS });
const sort = ref<PatientSort>({ ...DEFAULT_SORT });

/** Columnas de texto: las dos filas del encabezado y su filtro salen de acá. */
const TEXT_COLUMNS: { key: keyof PatientColumnFilters; label: string }[] = [
  { key: "identificacion", label: "Identificación" },
  { key: "nombre", label: "Nombre" },
  { key: "telefono", label: "Teléfono" },
  { key: "correo", label: "Correo" },
];

const FILTER_INPUT =
  "w-full rounded-md border border-slate-300 px-2 py-1 text-xs font-normal normal-case text-slate-700 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

const pageSize = ref<10 | 20 | 30>(10);
const currentPage = ref(1);
const totalCount = ref(0);
const totalPagesComputed = computed(() => computeTotalPages(totalCount.value, pageSize.value));

const patients = ref<PatientRow[]>([]);
const loading = ref(true);
/** Recarga por filtro/orden: la tabla sigue montada (si no, se pierde el foco del input). */
const refreshing = ref(false);
const error = ref<string | null>(null);

const showModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingPatient = ref<PatientRow | undefined>(undefined);
const citasPatient = ref<PatientRow | null>(null);

/**
 * Token de secuencia en vez de un booleano "hay una carga en curso": ese guard
 * descartaba la petición MÁS NUEVA (tocar un encabezado mientras viaja un filtro
 * dejaba la flecha mintiendo). Acá se descartan las respuestas viejas, lo que de
 * paso evita que dos cargas resuelvan en desorden.
 */
let loadSeq = 0;

async function load(opts: { silent?: boolean } = {}): Promise<void> {
  const seq = ++loadSeq;
  if (opts.silent) refreshing.value = true;
  else loading.value = true;
  error.value = null;
  try {
    // El MISMO filtro va a las filas y al conteo: si divergen, el paginador
    // calcula páginas sobre otra población que la que se muestra.
    const filter = buildPatientFilter({
      clinicId: clinica.activeClinicId ?? undefined,
      estado: estadoFilter.value,
      search: search.value,
      columns: columnFilters,
    });

    const [rows, countResult] = await Promise.all([
      directus.request(
        readItems("patients", {
          filter,
          sort: patientSort(sort.value),
          limit: pageSize.value,
          page: currentPage.value,
        }),
      ),
      directus.request(aggregate("patients", { aggregate: { count: "*" }, query: { filter } })),
    ]);
    if (seq !== loadSeq) return;
    patients.value = rows;
    totalCount.value = Number(countResult[0]?.count ?? 0);

    // Se dio de baja/borró el último registro de la página: retroceder en vez
    // de quedar mostrando una tabla vacía con páginas anteriores disponibles.
    if (patients.value.length === 0 && currentPage.value > 1) {
      currentPage.value = clampPage(currentPage.value - 1, totalPagesComputed.value);
      await load(opts);
      return;
    }
  } catch (e) {
    if (seq === loadSeq) error.value = friendlyErrorMessage(e, "No se pudieron cargar los pacientes.");
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}

function goToPage(page: number): void {
  const next = clampPage(page, totalPagesComputed.value);
  if (next === currentPage.value) return;
  currentPage.value = next;
  void load({ silent: true });
}

/** Los filtros consultan a Directus, así que esperan a que la recepcionista deje de escribir. */
const SEARCH_DEBOUNCE_MS = 300;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

/** Un solo timer para los seis campos de texto: todos terminan en la misma consulta. */
function scheduleReload(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentPage.value = 1;
    void load({ silent: true });
  }, SEARCH_DEBOUNCE_MS);
}

/** Cambios que no son de teclado: recargan ya y cancelan el debounce pendiente (si no, dispararía una segunda consulta inútil). */
function reloadNow(): void {
  if (searchTimer) clearTimeout(searchTimer);
  currentPage.value = 1;
  void load({ silent: true });
}

watch(search, scheduleReload);
watch(columnFilters, scheduleReload);
watch(estadoFilter, reloadNow);
watch(pageSize, reloadNow);

function toggleSort(key: PatientSortKey): void {
  sort.value = nextSort(sort.value, key);
  reloadNow();
}

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
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>
    <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="overflow-x-auto transition-opacity" :class="refreshing ? 'opacity-60' : ''">
        <table class="w-full min-w-[960px] text-left text-sm">
          <thead class="bg-slate-50">
            <tr>
              <th
                v-for="col in TEXT_COLUMNS"
                :key="col.key"
                class="whitespace-nowrap px-4 pt-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                :aria-sort="sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'"
              >
                <button
                  type="button"
                  class="flex items-center gap-1 uppercase transition hover:text-brand-700"
                  :aria-label="`Ordenar por ${col.label}`"
                  @click="toggleSort(col.key)"
                >
                  {{ col.label }}
                  <!-- La flecha inactiva se deja renderizada (en gris claro) para que el ancho de columna no salte al ordenar. -->
                  <span
                    class="text-[10px] leading-none"
                    :class="sort.key === col.key ? 'text-brand-600' : 'text-slate-300'"
                  >
                    {{ sort.key === col.key && sort.dir === "desc" ? "▼" : "▲" }}
                  </span>
                </button>
              </th>
              <th
                class="px-4 pt-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                :aria-sort="sort.key === 'estado' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'"
              >
                <button
                  type="button"
                  class="flex items-center gap-1 uppercase transition hover:text-brand-700"
                  aria-label="Ordenar por Estado"
                  @click="toggleSort('estado')"
                >
                  Estado
                  <span
                    class="text-[10px] leading-none"
                    :class="sort.key === 'estado' ? 'text-brand-600' : 'text-slate-300'"
                  >
                    {{ sort.key === "estado" && sort.dir === "desc" ? "▼" : "▲" }}
                  </span>
                </button>
              </th>
              <th class="px-4 pt-2.5"></th>
            </tr>
            <tr class="border-b border-slate-200">
              <th v-for="col in TEXT_COLUMNS" :key="col.key" class="whitespace-nowrap px-4 pb-2.5 pt-1.5 align-top font-normal">
                <input
                  v-model="columnFilters[col.key]"
                  :class="FILTER_INPUT"
                  placeholder="Filtrar"
                  :aria-label="`Filtrar por ${col.label}`"
                />
              </th>
              <th class="px-4 pb-2.5 pt-1.5 align-top font-normal">
                <select v-model="estadoFilter" :class="FILTER_INPUT" aria-label="Filtrar por estado">
                  <option value="activos">Activos</option>
                  <option value="inactivos">Dados de baja</option>
                  <option value="todos">Todos</option>
                </select>
              </th>
              <th class="px-4 pb-2.5 pt-1.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <!-- El vacío va DENTRO de la tabla: si la reemplazara, un filtro sin resultados escondería el input que hay que limpiar. -->
            <tr v-if="patients.length === 0">
              <td colspan="6">
                <EmptyState title="No hay pacientes para este filtro" />
              </td>
            </tr>
            <tr v-for="p in patients" :key="p.id" class="transition hover:bg-slate-50">
              <td class="whitespace-nowrap px-4 py-2.5 text-slate-600">{{ p.identificacion || "—" }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-slate-700">
                {{ p.nombre?.trim() || "(sin nombre)" }}
                <Badge v-if="p.titular" tone="neutral">Titular</Badge>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-slate-600">{{ p.telefono }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-slate-600">{{ p.correo || "—" }}</td>
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
                    title="Próximas citas"
                    :aria-label="`Próximas citas de ${p.nombre?.trim() || p.telefono}`"
                    @click="citasPatient = p"
                  >
                    <span class="h-4 w-4"><ActionIcon name="calendar" /></span>
                  </button>
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

    <div
      v-if="!loading && !error && totalCount > 0"
      class="mt-3 flex flex-wrap items-center justify-between gap-3"
    >
      <div class="flex items-center gap-2 text-xs text-slate-500">
        <span>{{ pageRangeLabel(currentPage, pageSize, totalCount) }}</span>
        <label class="flex items-center gap-1.5">
          Por página
          <select
            v-model.number="pageSize"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="30">30</option>
          </select>
        </label>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="secondary" size="sm" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">
          Anterior
        </Button>
        <span class="text-xs text-slate-500">Página {{ currentPage }} de {{ totalPagesComputed }}</span>
        <Button
          variant="secondary"
          size="sm"
          :disabled="currentPage === totalPagesComputed"
          @click="goToPage(currentPage + 1)"
        >
          Siguiente
        </Button>
      </div>
    </div>

    <PatientFormModal
      v-if="showModal"
      :mode="modalMode"
      :row="editingPatient"
      @close="showModal = false"
      @saved="handleSaved"
    />

    <PatientAppointmentsModal
      v-if="citasPatient"
      :patient="citasPatient"
      @close="citasPatient = null"
    />
  </div>
</template>
