<script setup lang="ts">
import { useCopyToClipboard } from "@/composables/useCopyToClipboard";

/**
 * Muestra un correo + contraseña temporal recién generados, con botón de copiar.
 * Se usa en el alta de usuarios y en el reset del admin.
 *
 * El aviso de "única vez" no es decorativo: la contraseña no se guarda en ningún
 * lado en claro, así que si esta pantalla se cierra sin copiarla, la única salida
 * es volver a restablecerla.
 */
const props = defineProps<{ email: string; password: string; label?: string }>();

const { copiedKey, copyError, copy } = useCopyToClipboard();

function copyBoth(): void {
  void copy(`${props.email}\n${props.password}`, props.email);
}
</script>

<template>
  <div class="rounded-lg border border-amber-200 bg-amber-50 p-3">
    <p v-if="props.label" class="mb-2 text-xs font-semibold text-amber-900">{{ props.label }}</p>
    <dl class="space-y-1 font-mono text-xs text-slate-800">
      <div class="flex gap-2">
        <dt class="w-20 flex-none text-slate-500">Correo</dt>
        <dd class="min-w-0 break-all">{{ props.email }}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="w-20 flex-none text-slate-500">Clave</dt>
        <dd class="min-w-0 break-all font-semibold">{{ props.password }}</dd>
      </div>
    </dl>
    <div class="mt-3 flex items-center gap-3">
      <button
        type="button"
        class="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
        @click="copyBoth"
      >
        {{ copiedKey === props.email ? "¡Copiado!" : "Copiar" }}
      </button>
      <p class="text-xs text-amber-800">Esta es la única vez que se muestra.</p>
    </div>
    <p v-if="copyError" class="mt-2 text-xs text-red-700">{{ copyError }}</p>
  </div>
</template>
