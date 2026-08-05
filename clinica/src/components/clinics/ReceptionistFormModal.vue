<script setup lang="ts">
import { ref } from "vue";
import { createItem, createUser, updateItem, updateUser } from "@directus/sdk";
import { directus } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { getRoleId } from "@/lib/directusRoles";
import { randomPassword } from "@/lib/passwords";
import Button from "@/components/ui/Button.vue";
import CredentialBlock from "@/components/clinics/CredentialBlock.vue";

export interface ReceptionistRow {
  linkId: string;
  userId: string;
  nombre: string;
  email: string;
  /** Campo custom de `directus_users`: la contraseña vigente es una temporal. */
  mustChangePassword: boolean;
  /** `clinics_directus_users.activo`: bloquea el acceso a ESTA clínica sin afectar otras donde esté vinculada. */
  activo: boolean;
}

const props = defineProps<{
  clinicId: string;
  mode: "create" | "edit";
  row?: ReceptionistRow;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const nombre = ref(props.row?.nombre ?? "");
const email = ref(props.row?.email ?? "");
const password = ref(randomPassword());
const activo = ref(props.row?.activo ?? true);

const saving = ref(false);
const error = ref<string | null>(null);
/**
 * Tras crear la cuenta, el formulario se reemplaza por la credencial en vez de
 * cerrarse: si el modal se cerrara directo, la contraseña generada se perdería
 * (no queda guardada en claro en ningún lado).
 */
const createdCredential = ref<{ email: string; password: string } | null>(null);

async function handleSubmit(): Promise<void> {
  error.value = null;
  if (!nombre.value.trim() || !email.value.trim()) {
    error.value = "Nombre y correo son obligatorios.";
    return;
  }
  saving.value = true;
  try {
    if (props.mode === "create") {
      const receptionistRoleId = await getRoleId("Receptionist");
      if (!receptionistRoleId) {
        error.value = "No se encontró el rol 'Receptionist' en Directus.";
        saving.value = false;
        return;
      }
      const userRow = (await directus.request(
        createUser({
          email: email.value.trim(),
          password: password.value,
          first_name: nombre.value.trim(),
          role: receptionistRoleId,
          status: "active",
          // La contraseña de acá es temporal: el titular define la suya al ingresar.
          must_change_password: true,
        } as never),
      )) as { id: string };
      await directus.request(
        createItem("clinics_directus_users" as never, {
          clinics_id: props.clinicId,
          directus_users_id: userRow.id,
        } as never),
      );
      createdCredential.value = { email: email.value.trim(), password: password.value };
      saving.value = false;
      return;
    } else if (props.row) {
      // `directus_users` es colección de sistema: NO se puede escribir vía el
      // genérico `updateItem` (Directus la bloquea en /items/, 403 incluso con
      // admin_access) — hace falta el helper dedicado `updateUser` (/users/:id).
      await directus.request(
        updateUser(props.row.userId as never, {
          first_name: nombre.value.trim(),
          email: email.value.trim(),
        } as never),
      );
      await directus.request(
        updateItem("clinics_directus_users" as never, props.row.linkId as never, {
          activo: activo.value,
        } as never),
      );
    }
    emit("saved");
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo guardar la recepcionista.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-4 text-lg font-bold text-brand-800">
        {{ mode === "create" ? "Agregar recepcionista" : "Editar recepcionista" }}
      </h2>

      <div v-if="createdCredential" class="space-y-4">
        <p class="text-sm text-slate-600">Cuenta creada. Pasale estos datos por un canal seguro.</p>
        <CredentialBlock :email="createdCredential.email" :password="createdCredential.password" />
        <div class="flex justify-end pt-2">
          <Button @click="emit('saved')">Listo</Button>
        </div>
      </div>

      <form v-else class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
          <input
            v-model="nombre"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="María López"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Correo</label>
          <input
            v-model="email"
            type="email"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="recepcion@ejemplo.com"
          />
        </div>

        <div v-if="mode === 'create'">
          <label class="mb-1 block text-sm font-medium text-slate-700">Contraseña</label>
          <input
            v-model="password"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        <p v-else class="text-xs text-slate-400">
          La titular cambia su contraseña desde su perfil; si la olvidó, usá "Restablecer contraseña" en la lista.
        </p>

        <label v-if="mode === 'edit'" class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="activo" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500/30" />
          Activo en esta clínica
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
