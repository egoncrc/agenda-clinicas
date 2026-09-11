<script setup lang="ts">
import { useIdleTimeoutState } from "@/composables/useIdleTimeout";
import Button from "@/components/ui/Button.vue";
import StatIcon from "@/components/ui/StatIcon.vue";

const { state, stayConnected } = useIdleTimeoutState();
</script>

<template>
  <div v-if="state.showWarning" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <span class="h-5 w-5"><StatIcon name="clock" /></span>
        </div>
        <div class="min-w-0 flex-1 pt-1">
          <h2 class="font-display text-lg font-bold text-brand-800">¿Seguís ahí?</h2>
          <p class="mt-1 text-sm text-slate-500">
            Tu sesión se cerrará en {{ state.secondsRemaining }} segundos por inactividad.
          </p>
        </div>
      </div>

      <div class="mt-6 flex justify-end">
        <Button variant="primary" @click="stayConnected">Seguir conectado</Button>
      </div>
    </div>
  </div>
</template>
