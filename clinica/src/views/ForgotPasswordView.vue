<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();

const email = ref("");
const submitting = ref(false);
const sent = ref(false);
/** Segundos que faltan para poder reenviar. Evita que un formulario público sirva para bombardear una bandeja. */
const cooldown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const COOLDOWN_SECONDS = 60;

function startCooldown(): void {
  cooldown.value = COOLDOWN_SECONDS;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

async function handleSubmit(): Promise<void> {
  submitting.value = true;
  try {
    await auth.requestPasswordReset(email.value);
  } catch {
    // Se traga a propósito: mostrar un error distinto cuando el correo no existe
    // convertiría esta pantalla en un enumerador de cuentas. Directus ya devuelve
    // lo mismo en ambos casos y el frontend no debe reintroducir la fuga.
  } finally {
    submitting.value = false;
    sent.value = true;
    startCooldown();
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 text-white">
            <rect x="3" y="5" width="18" height="15" rx="2" />
            <path d="M3 10h18" />
            <path d="M8 3v4M16 3v4" />
            <path d="M12 13.5v4M10 15.5h4" />
          </svg>
        </div>
        <span class="font-display text-base font-semibold text-brand-800">Agenda Médica</span>
      </div>

      <h1 class="font-display text-2xl font-bold text-slate-900">Recuperar contraseña</h1>
      <p class="mt-2 text-sm text-slate-500">
        Escribí tu correo y te mandamos un enlace para definir una contraseña nueva.
      </p>

      <div
        v-if="sent"
        class="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      >
        Si ese correo tiene una cuenta, te enviamos un enlace para restablecer la contraseña. Revisá también la
        carpeta de spam.
      </div>

      <form class="mt-8 space-y-5" @submit.prevent="handleSubmit">
        <div>
          <label for="email" class="mb-1.5 block text-sm font-medium text-slate-700">Correo electrónico</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="username"
            placeholder="tu@correo.com"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>

        <button
          type="submit"
          :disabled="submitting || cooldown > 0"
          class="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
        >
          <span v-if="submitting" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
          <template v-if="cooldown > 0">Podés reenviar en {{ cooldown }}s</template>
          <template v-else>{{ submitting ? "Enviando…" : sent ? "Reenviar enlace" : "Enviar enlace" }}</template>
        </button>
      </form>

      <p class="mt-8 text-center text-xs text-slate-400">
        <RouterLink to="/login" class="font-medium text-brand-600 hover:text-brand-800">Volver al ingreso</RouterLink>
      </p>
    </div>
  </div>
</template>
