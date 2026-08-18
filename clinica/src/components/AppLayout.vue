<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useClinicaStore } from "@/stores/clinica";
import AppNav from "@/components/AppNav.vue";
import NavIcon from "@/components/ui/NavIcon.vue";

const auth = useAuthStore();
const clinica = useClinicaStore();
const router = useRouter();

const mobileMenuOpen = ref(false);

const displayName = computed(() => auth.user?.firstName ?? auth.user?.email ?? "");
const initials = computed(() => {
  const first = auth.user?.firstName?.trim()?.[0];
  const last = auth.user?.lastName?.trim()?.[0];
  if (first && last) return `${first}${last}`.toUpperCase();
  return (auth.user?.email?.[0] ?? "?").toUpperCase();
});

async function handleLogout(): Promise<void> {
  mobileMenuOpen.value = false;
  await auth.logout();
  await router.push({ name: "login" });
}

async function handleChangeClinic(): Promise<void> {
  mobileMenuOpen.value = false;
  clinica.clearSelection();
  await router.push({ name: "seleccionar-clinica" });
}
</script>

<template>
  <!-- Altura fija del viewport: el menú lateral no debe crecer con el contenido de la vista.
       El único que scrollea es el <main>. -->
  <div class="flex h-dvh overflow-hidden bg-slate-50">
    <!-- Sidebar (desktop) -->
    <aside class="hidden w-60 flex-none flex-col border-r border-slate-200 bg-white lg:flex">
      <div class="flex items-center gap-2.5 px-5 py-5">
        <div class="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 text-white">
            <rect x="3" y="5" width="18" height="15" rx="2" />
            <path d="M3 10h18" />
            <path d="M8 3v4M16 3v4" />
            <path d="M12 13.5v4M10 15.5h4" />
          </svg>
        </div>
        <span class="font-display text-sm font-semibold text-brand-900">Agenda Médica</span>
      </div>

      <AppNav />

      <div v-if="clinica.activeClinic" class="border-t border-slate-200 px-3 pt-3">
        <button
          v-if="clinica.clinics.length > 1"
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          title="Cambiar de clínica"
          @click="handleChangeClinic"
        >
          <span class="min-w-0 flex-1 truncate font-medium">{{ clinica.activeClinic.nombre }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 flex-none">
            <path d="m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16" />
          </svg>
        </button>
        <p v-else class="truncate px-2 py-1.5 text-xs font-medium text-slate-500">{{ clinica.activeClinic.nombre }}</p>
      </div>

      <div class="border-t border-slate-200 p-3">
        <div class="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <!-- El bloque de usuario lleva al perfil (cambiar contraseña y datos propios):
               es el gesto que la gente ya espera de un panel y no suma un ítem al nav. -->
          <RouterLink
            to="/perfil"
            class="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg transition hover:bg-slate-100"
            title="Mi perfil"
          >
            <div
              class="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700"
            >
              {{ initials }}
            </div>
            <p class="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{{ displayName }}</p>
          </RouterLink>
          <button
            type="button"
            class="flex h-7 w-7 flex-none items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            title="Salir"
            aria-label="Salir"
            @click="handleLogout"
          >
            <span class="h-4 w-4"><NavIcon name="logout" /></span>
          </button>
        </div>
      </div>
    </aside>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Header (mobile) -->
      <header class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-white">
              <rect x="3" y="5" width="18" height="15" rx="2" />
              <path d="M3 10h18" />
              <path d="M8 3v4M16 3v4" />
              <path d="M12 13.5v4M10 15.5h4" />
            </svg>
          </div>
          <span class="font-display text-sm font-semibold text-brand-900">Agenda Médica</span>
        </div>
        <button
          type="button"
          class="rounded-md p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Abrir menú"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      <!-- Drawer (mobile) -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="mobileMenuOpen" class="fixed inset-0 z-30 lg:hidden">
          <div class="absolute inset-0 bg-slate-900/40" @click="mobileMenuOpen = false"></div>
          <aside class="relative z-10 flex h-full w-64 max-w-[80vw] flex-col bg-white shadow-xl">
            <div class="flex items-center gap-2.5 px-5 py-5">
              <div class="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 text-white">
                  <rect x="3" y="5" width="18" height="15" rx="2" />
                  <path d="M3 10h18" />
                  <path d="M8 3v4M16 3v4" />
                  <path d="M12 13.5v4M10 15.5h4" />
                </svg>
              </div>
              <span class="font-display text-sm font-semibold text-brand-900">Agenda Médica</span>
            </div>

            <AppNav @navigate="mobileMenuOpen = false" />

            <div v-if="clinica.activeClinic" class="border-t border-slate-200 px-3 pt-3">
              <button
                v-if="clinica.clinics.length > 1"
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                @click="handleChangeClinic"
              >
                <span class="min-w-0 flex-1 truncate font-medium">{{ clinica.activeClinic.nombre }}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 flex-none">
                  <path d="m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16" />
                </svg>
              </button>
              <p v-else class="truncate px-2 py-1.5 text-xs font-medium text-slate-500">{{ clinica.activeClinic.nombre }}</p>
            </div>

            <div class="border-t border-slate-200 p-3">
              <div class="flex items-center gap-2.5 rounded-lg px-2 py-2">
                <RouterLink
                  to="/perfil"
                  class="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg transition hover:bg-slate-100"
                  title="Mi perfil"
                  @click="mobileMenuOpen = false"
                >
                  <div
                    class="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700"
                  >
                    {{ initials }}
                  </div>
                  <p class="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{{ displayName }}</p>
                </RouterLink>
                <button
                  type="button"
                  class="flex h-7 w-7 flex-none items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  title="Salir"
                  aria-label="Salir"
                  @click="handleLogout"
                >
                  <span class="h-4 w-4"><NavIcon name="logout" /></span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      </Transition>

      <main
        class="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10 lg:py-8"
        style="background-image: radial-gradient(circle at 1px 1px, rgb(226 232 240) 1px, transparent 0); background-size: 24px 24px"
      >
        <div class="mx-auto w-[90%] max-w-none">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
