<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { updateMe } from "@directus/sdk";
import ChangePasswordForm from "@/components/ChangePasswordForm.vue";
import Button from "@/components/ui/Button.vue";
import Card from "@/components/ui/Card.vue";
import { directus } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();

const firstName = ref(auth.user?.firstName ?? "");
const lastName = ref(auth.user?.lastName ?? "");
const savingData = ref(false);
const dataSaved = ref(false);
const dataError = ref<string | null>(null);

const passwordChanged = ref(false);

/** `first_name`/`last_name` están en la lista blanca de campos que Directus deja escribir sobre la propia fila. */
async function saveData(): Promise<void> {
  savingData.value = true;
  dataSaved.value = false;
  dataError.value = null;
  try {
    await directus.request(updateMe({ first_name: firstName.value, last_name: lastName.value } as never));
    await auth.loadUser();
    dataSaved.value = true;
  } catch (e) {
    dataError.value = friendlyErrorMessage(e, "No se pudieron guardar tus datos.");
  } finally {
    savingData.value = false;
  }
}

function onPasswordChanged(): void {
  passwordChanged.value = true;
}

async function onSessionLost(): Promise<void> {
  await auth.logout().catch(() => {});
  await router.push({ name: "login", query: { cambiada: "1" } });
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div>
      <h1 class="font-display text-xl font-bold text-slate-900">Mi perfil</h1>
      <p class="mt-1 text-sm text-slate-500">Tus datos de acceso al panel.</p>
    </div>

    <Card title="Mis datos">
      <form class="space-y-4" @submit.prevent="saveData">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="first-name" class="mb-1.5 block text-sm font-medium text-slate-700">Nombre</label>
            <input
              id="first-name"
              v-model="firstName"
              type="text"
              class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div>
            <label for="last-name" class="mb-1.5 block text-sm font-medium text-slate-700">Apellido</label>
            <input
              id="last-name"
              v-model="lastName"
              type="text"
              class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
        </div>

        <div>
          <label for="profile-email" class="mb-1.5 block text-sm font-medium text-slate-700">Correo</label>
          <input
            id="profile-email"
            :value="auth.user?.email"
            type="email"
            readonly
            class="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500"
          />
          <p class="mt-1.5 text-xs text-slate-400">Para cambiar tu correo, pedíselo al administrador.</p>
        </div>

        <p v-if="dataError" class="text-sm text-red-600">{{ dataError }}</p>
        <div class="flex items-center gap-3">
          <Button type="submit" :loading="savingData">Guardar</Button>
          <p v-if="dataSaved" class="text-sm text-emerald-600">Guardado.</p>
        </div>
      </form>
    </Card>

    <Card title="Cambiar contraseña">
      <p
        v-if="passwordChanged"
        class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800"
      >
        Tu contraseña se cambió correctamente.
      </p>
      <ChangePasswordForm @changed="onPasswordChanged" @session-lost="onSessionLost" />
    </Card>
  </div>
</template>
