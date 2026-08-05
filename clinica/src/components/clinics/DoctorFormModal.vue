<script setup lang="ts">
import { ref } from "vue";
import { createItem, createUser, readItems, updateItem, updateUser } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { ClinicDoctor, SpecialtyRow } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { getRoleId } from "@/lib/directusRoles";
import { randomPassword } from "@/lib/passwords";
import Button from "@/components/ui/Button.vue";
import CredentialBlock from "@/components/clinics/CredentialBlock.vue";

const props = defineProps<{
  clinicId: string;
  mode: "create" | "edit";
  row?: ClinicDoctor;
  specialties: SpecialtyRow[];
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const nombre = ref(props.row?.nombre ?? "");
const specialty = ref(props.row?.specialty ?? props.specialties[0]?.id ?? "");
const activo = ref(props.row?.activo ?? true);

// Solo tiene sentido ofrecer crear login si todavía no tiene uno.
const hasLogin = Boolean(props.row?.usuario);
const wantsLogin = ref(props.mode === "create");
const email = ref("");
const password = ref(randomPassword());

const saving = ref(false);
const error = ref<string | null>(null);
/**
 * Si se creó un acceso al panel, el formulario se reemplaza por la credencial en
 * vez de cerrarse: la contraseña generada no queda guardada en claro en ningún
 * lado, así que cerrar el modal directo la perdería.
 */
const createdCredential = ref<{ email: string; password: string } | null>(null);

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
  if (wantsLogin.value && !email.value.trim()) {
    error.value = "Falta el correo para crear el acceso al panel.";
    return;
  }

  saving.value = true;
  try {
    let usuarioId: string | undefined;
    if (wantsLogin.value && email.value.trim()) {
      const doctorRoleId = await getRoleId("Doctor");
      if (!doctorRoleId) {
        error.value = "No se encontró el rol 'Doctor' en Directus — no se puede crear el acceso.";
        saving.value = false;
        return;
      }
      const userRow = (await directus.request(
        createUser({
          email: email.value.trim(),
          password: password.value,
          first_name: nombre.value.trim(),
          role: doctorRoleId,
          status: "active",
          // La contraseña de acá es temporal: el titular define la suya al ingresar.
          must_change_password: true,
        } as never),
      )) as { id: string };
      usuarioId = userRow.id;
      createdCredential.value = { email: email.value.trim(), password: password.value };
    }

    if (props.mode === "create") {
      // La identidad va en `doctors` y lo que depende de la sede (especialidad,
      // alta/baja) en la fila puente: el mismo médico puede vincularse después a
      // otra clínica con otra especialidad.
      const doctorRow = (await directus.request(
        createItem("doctors", {
          nombre: nombre.value.trim(),
          activo: true,
          ...(usuarioId ? { usuario: usuarioId } : {}),
        }),
      )) as { id: string };
      await directus.request(
        createItem("clinics_doctors", {
          clinics_id: props.clinicId,
          doctors_id: doctorRow.id,
          specialty: specialty.value,
          activo: true,
        }),
      );
    } else if (props.row) {
      await directus.request(
        updateItem("doctors", props.row.id, {
          nombre: nombre.value.trim(),
          ...(usuarioId ? { usuario: usuarioId } : {}),
        }),
      );
      await directus.request(
        updateItem("clinics_doctors", props.row.linkId, {
          specialty: specialty.value,
          activo: activo.value,
        }),
      );
      // La cuenta de Directus es una sola para el médico, pero puede trabajar en
      // varias clínicas: solo se suspende si quedó inactivo en TODAS. Si sigue
      // activo en alguna otra, tiene que poder ingresar.
      if (props.row.usuario) {
        const links = await directus.request(
          readItems("clinics_doctors", {
            filter: { doctors_id: { _eq: props.row.id }, activo: { _eq: true } },
            limit: -1,
            fields: ["id"],
          }),
        );
        // `directus_users` es colección de sistema: NO se puede escribir vía el
        // genérico `updateItem` (Directus la bloquea en /items/, 403 incluso con
        // admin_access) — hace falta el helper dedicado `updateUser` (/users/:id).
        await directus.request(
          updateUser(props.row.usuario as never, {
            status: links.length > 0 ? "active" : "suspended",
          } as never),
        );
      }
    }
    // Con acceso nuevo, la credencial se muestra antes de cerrar; el `saved` lo
    // emite el botón "Listo" de esa pantalla.
    if (!createdCredential.value) emit("saved");
  } catch (e) {
    // Si el fallo fue DESPUÉS de crear el usuario (al escribir la fila `doctors`),
    // `createdCredential` queda puesto a propósito: esa cuenta ya existe con esa
    // contraseña y perderla sería peor que el error en sí. La plantilla muestra
    // las dos cosas.
    error.value = friendlyErrorMessage(e, "No se pudo guardar el médico.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-4 text-lg font-bold text-brand-800">
        {{ mode === "create" ? "Agregar médico" : "Editar médico" }}
      </h2>

      <div v-if="createdCredential" class="space-y-4">
        <p v-if="error" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {{ error }} La cuenta de acceso sí quedó creada — anotá estos datos y revisá la ficha del médico.
        </p>
        <p v-else class="text-sm text-slate-600">Acceso creado. Pasale estos datos por un canal seguro.</p>
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
            placeholder="Dr. Juan Pérez"
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

        <label v-if="mode === 'edit'" class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="activo" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500/30" />
          Activo
        </label>

        <p v-if="hasLogin" class="text-xs text-slate-400">
          Ya tiene acceso al panel. El titular cambia su contraseña desde su perfil; si la olvidó, usá
          "Restablecer contraseña" en la lista de médicos.
        </p>
        <template v-else>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input v-model="wantsLogin" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500/30" />
            Crear acceso al panel
          </label>
          <div v-if="wantsLogin" class="space-y-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Correo</label>
              <input
                v-model="email"
                type="email"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                placeholder="doctor@ejemplo.com"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Contraseña</label>
              <input
                v-model="password"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>
        </template>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="secondary" @click="emit('close')">Cancelar</Button>
          <Button type="submit" :loading="saving">{{ saving ? "Guardando…" : "Guardar" }}</Button>
        </div>
      </form>
    </div>
  </div>
</template>
