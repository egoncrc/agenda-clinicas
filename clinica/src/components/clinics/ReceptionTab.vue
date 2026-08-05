<script setup lang="ts">
import { onMounted, ref } from "vue";
import { deleteItem, readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useConfirm } from "@/composables/useConfirm";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";
import ReceptionistFormModal, { type ReceptionistRow } from "@/components/clinics/ReceptionistFormModal.vue";
import ResetPasswordModal from "@/components/clinics/ResetPasswordModal.vue";

const props = defineProps<{ clinicId: string }>();

const confirm = useConfirm();
const receptionists = ref<ReceptionistRow[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const showModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingRow = ref<ReceptionistRow | undefined>(undefined);
const resettingRow = ref<ReceptionistRow | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const rows = (await directus.request(
      readItems("clinics_directus_users" as never, {
        filter: { clinics_id: { _eq: props.clinicId } },
        fields: [
          "id",
          "activo",
          "directus_users_id.id",
          "directus_users_id.first_name",
          "directus_users_id.email",
          "directus_users_id.must_change_password",
        ],
        limit: -1,
      } as never),
    )) as {
      id: string;
      activo: boolean | null;
      directus_users_id: {
        id: string;
        first_name: string | null;
        email: string | null;
        must_change_password: boolean | null;
      };
    }[];
    receptionists.value = rows.map((r) => ({
      linkId: r.id,
      userId: r.directus_users_id.id,
      nombre: r.directus_users_id.first_name ?? "(sin nombre)",
      email: r.directus_users_id.email ?? "",
      mustChangePassword: r.directus_users_id.must_change_password === true,
      activo: r.activo !== false,
    }));
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudieron cargar las recepcionistas.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openCreate(): void {
  modalMode.value = "create";
  editingRow.value = undefined;
  showModal.value = true;
}

function openEdit(row: ReceptionistRow): void {
  modalMode.value = "edit";
  editingRow.value = row;
  showModal.value = true;
}

async function handleSaved(): Promise<void> {
  showModal.value = false;
  await load();
}

async function handleResetDone(): Promise<void> {
  resettingRow.value = null;
  await load();
}

async function unlink(row: ReceptionistRow): Promise<void> {
  const ok = await confirm({
    title: "Quitar de esta clínica",
    message: `"${row.nombre}" deja de tener acceso a esta clínica. Su cuenta no se elimina — sigue existiendo por si está vinculada a otra clínica.`,
    confirmLabel: "Quitar",
  });
  if (!ok) return;
  error.value = null;
  try {
    await directus.request(deleteItem("clinics_directus_users" as never, row.linkId as never));
    await load();
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo quitar.");
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex justify-end">
      <Button size="sm" @click="openCreate">+ Agregar recepcionista</Button>
    </div>

    <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>
    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>

    <ul v-else-if="receptionists.length > 0" class="divide-y divide-slate-100">
      <li v-for="r in receptionists" :key="r.linkId" class="flex items-center justify-between gap-3 py-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="truncate text-sm font-medium text-slate-700">{{ r.nombre }}</span>
          <span class="truncate text-xs text-slate-400">{{ r.email }}</span>
          <Badge :tone="r.activo ? 'success' : 'neutral'">{{ r.activo ? "Activo" : "Inactivo" }}</Badge>
          <Badge v-if="r.mustChangePassword" tone="warn">Debe cambiar clave</Badge>
        </div>
        <div class="flex flex-none items-center gap-0.5">
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-brand-600 hover:bg-brand-50"
            aria-label="Editar"
            @click="openEdit(r)"
          >
            <span class="h-4 w-4"><ActionIcon name="edit" /></span>
          </button>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
            aria-label="Restablecer contraseña"
            title="Restablecer contraseña"
            @click="resettingRow = r"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <circle cx="7.5" cy="15.5" r="3.5" />
              <path d="m10 13 8-8 3 3-2 2-2-2-2 2 2 2-3 3" />
            </svg>
          </button>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-red-500 hover:bg-red-50"
            aria-label="Quitar"
            @click="unlink(r)"
          >
            <span class="h-4 w-4"><ActionIcon name="trash" /></span>
          </button>
        </div>
      </li>
    </ul>
    <EmptyState v-else-if="!loading" title="Sin recepcionistas" description="Agregá la primera con el botón de arriba." />

    <ReceptionistFormModal
      v-if="showModal"
      :clinic-id="props.clinicId"
      :mode="modalMode"
      :row="editingRow"
      @close="showModal = false"
      @saved="handleSaved"
    />

    <ResetPasswordModal
      v-if="resettingRow"
      :user-id="resettingRow.userId"
      :nombre="resettingRow.nombre"
      :email="resettingRow.email"
      @close="resettingRow = null"
      @done="handleResetDone"
    />
  </div>
</template>
