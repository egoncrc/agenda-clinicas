<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import PasswordFields from "@/components/PasswordFields.vue";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const route = useRoute();

/** El token llega en la query del enlace del correo (ver PASSWORD_RESET_URL en stores/auth.ts). */
const token = computed(() => (typeof route.query.token === "string" ? route.query.token : null));

const password = ref("");
const confirmation = ref("");
const showPassword = ref(false);
const valid = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);
const done = ref(false);

async function handleSubmit(): Promise<void> {
  if (!token.value || !valid.value) return;
  submitting.value = true;
  error.value = null;
  try {
    await auth.resetPassword(token.value, password.value);
    done.value = true;
  } catch (e) {
    error.value = friendlyErrorMessage(e, "El enlace expiró o ya se usó. Pedí uno nuevo.");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="flex min-h-screen flex-col justify-center bg-slate-50 px-6 py-12"
    style="background-image: radial-gradient(circle at 1px 1px, rgb(226 232 240) 1px, transparent 0); background-size: 24px 24px"
  >
    <div class="mx-auto w-full max-w-sm">
      <div class="mb-10 flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700">
          <span class="font-display text-sm font-bold text-white">CD</span>
        </div>
        <span class="font-display text-base font-semibold text-brand-800">Clínica</span>
      </div>

      <!-- Enlace roto o incompleto -->
      <template v-if="!token">
        <h1 class="font-display text-2xl font-bold text-slate-900">Enlace inválido</h1>
        <p class="mt-2 text-sm text-slate-500">
          El enlace está incompleto. Pedí uno nuevo desde la pantalla de recuperación.
        </p>
        <RouterLink
          to="/recuperar-clave"
          class="mt-8 flex w-full items-center justify-center rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-800"
        >
          Pedir un enlace nuevo
        </RouterLink>
      </template>

      <!-- Listo: no se loguea automáticamente, se le pide entrar con la nueva clave -->
      <template v-else-if="done">
        <h1 class="font-display text-2xl font-bold text-slate-900">Contraseña actualizada</h1>
        <p class="mt-2 text-sm text-slate-500">Ya podés ingresar al panel con tu contraseña nueva.</p>
        <RouterLink
          to="/login"
          class="mt-8 flex w-full items-center justify-center rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-800"
        >
          Ir al ingreso
        </RouterLink>
      </template>

      <template v-else>
        <h1 class="font-display text-2xl font-bold text-slate-900">Definí tu contraseña</h1>
        <p class="mt-2 text-sm text-slate-500">Elegí una contraseña nueva para tu cuenta.</p>

        <form class="mt-8 space-y-5" @submit.prevent="handleSubmit">
          <PasswordFields
            v-model:password="password"
            v-model:confirmation="confirmation"
            v-model:show="showPassword"
            v-model:valid="valid"
          />

          <p v-if="error" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {{ error }}
          </p>

          <button
            type="submit"
            :disabled="submitting || !valid"
            class="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
          >
            <span v-if="submitting" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
            {{ submitting ? "Guardando…" : "Guardar contraseña" }}
          </button>
        </form>
      </template>

      <p class="mt-8 text-center text-xs text-slate-400">
        <RouterLink to="/login" class="font-medium text-brand-600 hover:text-brand-800">Volver al ingreso</RouterLink>
      </p>
    </div>
  </div>
</template>
