<script setup lang="ts">
import { computed, ref } from "vue";
import type { ClinicDoctor, SpecialtyRow } from "@/lib/directus";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import ActionIcon from "@/components/ui/ActionIcon.vue";
import DoctorFormModal from "@/components/clinics/DoctorFormModal.vue";
import LinkDoctorModal from "@/components/clinics/LinkDoctorModal.vue";
import ResetPasswordModal from "@/components/clinics/ResetPasswordModal.vue";

const props = defineProps<{
  clinicId: string;
  doctors: ClinicDoctor[];
  specialties: SpecialtyRow[];
  /**
   * Estado de la cuenta de cada médico que tiene login, indexado por id de
   * usuario. Viene del padre porque `doctors` no trae datos de `directus_users`.
   */
  userAccounts?: Record<string, { email: string; mustChangePassword: boolean }>;
}>();
const emit = defineEmits<{ changed: [] }>();

const showModal = ref(false);
const showLinkModal = ref(false);
const modalMode = ref<"create" | "edit">("create");
const editingRow = ref<ClinicDoctor | undefined>(undefined);
const resettingDoctor = ref<ClinicDoctor | null>(null);

function account(row: ClinicDoctor) {
  return row.usuario ? props.userAccounts?.[row.usuario] : undefined;
}

function specialtyName(id: string): string {
  return props.specialties.find((s) => s.id === id)?.nombre ?? "(especialidad)";
}

const canCreate = computed(() => props.specialties.length > 0);

function openCreate(): void {
  modalMode.value = "create";
  editingRow.value = undefined;
  showModal.value = true;
}

function openEdit(row: ClinicDoctor): void {
  modalMode.value = "edit";
  editingRow.value = row;
  showModal.value = true;
}

function handleSaved(): void {
  showModal.value = false;
  emit("changed");
}

function handleLinked(): void {
  showLinkModal.value = false;
  emit("changed");
}

function handleResetDone(): void {
  resettingDoctor.value = null;
  emit("changed");
}
</script>

<template>
  <div>
    <div class="mb-4 flex flex-col items-end gap-1">
      <div class="flex gap-2">
        <Button size="sm" variant="secondary" :disabled="!canCreate" @click="showLinkModal = true">
          Vincular existente
        </Button>
        <Button size="sm" :disabled="!canCreate" @click="openCreate">+ Agregar médico</Button>
      </div>
      <p v-if="!canCreate" class="text-xs text-amber-600">Agregá primero una especialidad.</p>
    </div>

    <ul v-if="doctors.length > 0" class="divide-y divide-slate-100">
      <li v-for="d in doctors" :key="d.id" class="flex items-center justify-between gap-3 py-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="truncate text-sm font-medium text-slate-700">{{ d.nombre }}</span>
          <span class="text-xs text-slate-400">{{ specialtyName(d.specialty) }}</span>
          <Badge :tone="d.activo ? 'success' : 'neutral'">{{ d.activo ? "Activo" : "Inactivo" }}</Badge>
          <Badge v-if="d.usuario" tone="info">Con acceso</Badge>
          <Badge v-if="account(d)?.mustChangePassword" tone="warn">Debe cambiar clave</Badge>
        </div>
        <div class="flex flex-none items-center gap-0.5">
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-brand-600 hover:bg-brand-50"
            aria-label="Editar"
            @click="openEdit(d)"
          >
            <span class="h-4 w-4"><ActionIcon name="edit" /></span>
          </button>
          <!-- Solo si tiene login: sin cuenta no hay contraseña que restablecer. -->
          <button
            v-if="account(d)"
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
            aria-label="Restablecer contraseña"
            title="Restablecer contraseña"
            @click="resettingDoctor = d"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <circle cx="7.5" cy="15.5" r="3.5" />
              <path d="m10 13 8-8 3 3-2 2-2-2-2 2 2 2-3 3" />
            </svg>
          </button>
        </div>
      </li>
    </ul>
    <EmptyState v-else title="Sin médicos" description="Agregá el primero con el botón de arriba." />

    <DoctorFormModal
      v-if="showModal"
      :clinic-id="props.clinicId"
      :mode="modalMode"
      :row="editingRow"
      :specialties="props.specialties"
      @close="showModal = false"
      @saved="handleSaved"
    />

    <LinkDoctorModal
      v-if="showLinkModal"
      :clinic-id="props.clinicId"
      :specialties="props.specialties"
      :ya-vinculados="props.doctors.map((d) => d.id)"
      @close="showLinkModal = false"
      @saved="handleLinked"
    />

    <ResetPasswordModal
      v-if="resettingDoctor && account(resettingDoctor)"
      :user-id="resettingDoctor.usuario!"
      :nombre="resettingDoctor.nombre"
      :email="account(resettingDoctor)!.email"
      @close="resettingDoctor = null"
      @done="handleResetDone"
    />
  </div>
</template>
