<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useClinicaStore } from "@/stores/clinica";
import { useCatalogStore } from "@/stores/catalog";
import Card from "@/components/ui/Card.vue";

const auth = useAuthStore();
const clinica = useClinicaStore();
const catalog = useCatalogStore();
const router = useRouter();

async function choose(id: string): Promise<void> {
  clinica.selectClinic(id);
  catalog.reset();
  await router.push({ name: "dashboard" });
}

async function handleLogout(): Promise<void> {
  await auth.logout();
  await router.push({ name: "login" });
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
          <span class="font-display text-lg font-bold text-white">CD</span>
        </div>
        <span class="font-display text-lg font-semibold tracking-tight text-white">Clínica</span>
      </div>

      <div class="relative z-10 max-w-md">
        <h2 class="font-display text-3xl font-bold leading-tight text-white xl:text-4xl">
          Una cuenta, varias clínicas
        </h2>
        <p class="mt-4 text-base leading-relaxed text-brand-100/80">
          Tu usuario está vinculado a más de una clínica. Elegí con cuál querés trabajar ahora — vas a ver y
          gestionar solo la información de esa clínica.
        </p>
      </div>

      <p class="relative z-10 text-xs text-brand-200/50">Podés cambiar de clínica cuando quieras desde el panel.</p>
    </div>

    <!-- Selección -->
    <div
      class="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 xl:px-20"
      style="background-image: radial-gradient(circle at 1px 1px, rgb(226 232 240) 1px, transparent 0); background-size: 24px 24px"
    >
      <div class="mx-auto w-full max-w-sm">
        <div class="mb-10 flex items-center gap-3 lg:hidden">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700">
            <span class="font-display text-sm font-bold text-white">CD</span>
          </div>
          <span class="font-display text-base font-semibold text-brand-800">Clínica</span>
        </div>

        <template v-if="clinica.clinics.length > 0">
          <h1 class="font-display text-2xl font-bold text-slate-900">Elegí una clínica</h1>
          <p class="mt-2 text-sm text-slate-500">Vas a acceder solo a la información de la clínica que elijas.</p>

          <div class="mt-8 space-y-3">
            <button
              v-for="clinic in clinica.clinics"
              :key="clinic.id"
              type="button"
              class="w-full text-left"
              @click="choose(clinic.id)"
            >
              <Card
                class="flex items-center justify-between gap-3 transition hover:border-brand-300 hover:bg-brand-50/50 active:scale-[0.99]"
              >
                <div class="flex items-center gap-3">
                  <div class="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-100 text-sm font-semibold text-brand-700">
                    {{ clinic.nombre.trim().slice(0, 2).toUpperCase() }}
                  </div>
                  <span class="font-medium text-slate-800">{{ clinic.nombre }}</span>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 flex-none text-slate-400">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Card>
            </button>
          </div>
        </template>
        <template v-else>
          <h1 class="font-display text-2xl font-bold text-slate-900">Sin clínicas asignadas</h1>
          <p class="mt-2 text-sm text-slate-500">
            No tenés clínicas activas asignadas. Contactá al administrador.
          </p>
        </template>

        <button
          type="button"
          class="mt-8 w-full text-center text-xs font-medium text-slate-400 hover:text-slate-600"
          @click="handleLogout"
        >
          ¿No es tu cuenta? Cerrar sesión
        </button>
      </div>
    </div>
  </div>
</template>
