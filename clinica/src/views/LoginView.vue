<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref("");
const password = ref("");
const submitting = ref(false);
const showPassword = ref(false);

/**
 * Lo pone `/perfil` o `/cambiar-clave` cuando la contraseña se cambió con éxito
 * pero la sesión de cookie no sobrevivió al cambio. Sin este aviso, el usuario
 * volvería al login sin saber si el cambio se aplicó.
 */
const passwordJustChanged = computed(() => route.query.cambiada === "1");

/** Lo pone el guard de 401 de `lib/directus.ts` cuando la sesión murió con el panel abierto. */
const sessionExpired = computed(() => route.query.expirada === "1");

const currentYear = new Date().getFullYear();

const FEATURES = [
  "Agenda por médico con disponibilidad en tiempo real",
  "Lista de espera con oferta automática de cupos liberados",
  "Recordatorios y confirmaciones por WhatsApp",
];

async function handleSubmit(): Promise<void> {
  submitting.value = true;
  try {
    await auth.login(email.value, password.value);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await router.push(redirect);
  } catch {
    // auth.loginError ya quedó seteado por el store.
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-screen bg-slate-50 lg:grid-cols-2">
    <!-- Panel de marca (oculto en mobile) -->
    <div
      class="relative hidden overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16"
    >
      <div class="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-400/20 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-brand-300/10 blur-3xl"></div>
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.07]"
        style="background-image: radial-gradient(circle at 1px 1px, white 1px, transparent 0); background-size: 28px 28px"
      ></div>

      <div class="relative z-10 flex items-center gap-3">
        <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6 text-white">
            <rect x="3" y="5" width="18" height="15" rx="2" />
            <path d="M3 10h18" />
            <path d="M8 3v4M16 3v4" />
            <path d="M12 13.5v4M10 15.5h4" />
          </svg>
        </div>
        <span class="font-display text-lg font-semibold tracking-tight text-white">Agenda Médica</span>
      </div>

      <div class="relative z-10 max-w-md">
        <h2 class="font-display text-3xl font-bold leading-tight text-white xl:text-4xl">
          Gestioná tu clínica con claridad
        </h2>
        <p class="mt-4 text-base leading-relaxed text-brand-100/80">
          Agenda, pacientes y lista de espera en un solo lugar, sincronizado en tiempo real con tu asistente de
          WhatsApp.
        </p>

        <ul class="mt-10 space-y-4">
          <li v-for="feature in FEATURES" :key="feature" class="flex items-start gap-3">
            <span class="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 text-white">
                <path d="m5 12.5 4.5 4.5L19 7" />
              </svg>
            </span>
            <span class="text-sm leading-relaxed text-brand-100/90">{{ feature }}</span>
          </li>
        </ul>
      </div>

      <p class="relative z-10 text-xs text-brand-200/50">© {{ currentYear }} Agenda Médica — Panel interno</p>
    </div>

    <!-- Formulario -->
    <div
      class="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 xl:px-20"
      style="background-image: radial-gradient(circle at 1px 1px, rgb(226 232 240) 1px, transparent 0); background-size: 24px 24px"
    >
      <div class="mx-auto w-full max-w-sm">
        <div class="mb-10 flex items-center gap-3 lg:hidden">
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

        <h1 class="font-display text-2xl font-bold text-slate-900">Bienvenido de nuevo</h1>
        <p class="mt-2 text-sm text-slate-500">Ingresá con tu cuenta para acceder al panel.</p>

        <div
          v-if="passwordJustChanged"
          class="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800"
        >
          Tu contraseña se cambió. Ingresá con la nueva.
        </div>

        <div
          v-if="sessionExpired"
          class="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
        >
          Tu sesión expiró. Volvé a ingresar.
        </div>

        <form class="mt-8 space-y-5" @submit.prevent="handleSubmit">
          <div>
            <label for="email" class="mb-1.5 block text-sm font-medium text-slate-700">Correo electrónico</label>
            <div class="relative">
              <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
              </span>
              <input
                id="email"
                v-model="email"
                type="email"
                required
                autocomplete="username"
                placeholder="tu@correo.com"
                class="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>

          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <label for="password" class="block text-sm font-medium text-slate-700">Contraseña</label>
              <div class="flex items-center gap-3">
                <RouterLink to="/recuperar-clave" class="text-xs font-medium text-brand-600 hover:text-brand-800">
                  ¿Olvidaste tu contraseña?
                </RouterLink>
                <button
                  type="button"
                  class="text-xs font-medium text-brand-600 hover:text-brand-800"
                  @click="showPassword = !showPassword"
                >
                  {{ showPassword ? "Ocultar" : "Mostrar" }}
                </button>
              </div>
            </div>
            <div class="relative">
              <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </span>
              <input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                required
                autocomplete="current-password"
                placeholder="••••••••"
                class="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>

          <Transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="opacity-0 -translate-y-1"
            enter-to-class="opacity-100 translate-y-0"
          >
            <div v-if="auth.loginError" class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 h-4 w-4 flex-none text-red-500">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5" />
                <path d="M12 16h.01" />
              </svg>
              <p class="text-sm text-red-700">{{ auth.loginError }}</p>
            </div>
          </Transition>

          <button
            type="submit"
            :disabled="submitting"
            class="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
          >
            <span
              v-if="submitting"
              class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            ></span>
            {{ submitting ? "Ingresando…" : "Ingresar" }}
          </button>
        </form>

        <p class="mt-8 text-center text-xs text-slate-400">
          ¿Seguís sin poder entrar? Contactá al administrador del sistema.
        </p>
      </div>
    </div>
  </div>
</template>
