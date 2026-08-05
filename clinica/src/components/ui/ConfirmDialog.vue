<script setup lang="ts">
import { watch } from "vue";
import { useConfirmDialogState } from "@/composables/useConfirm";
import Button from "@/components/ui/Button.vue";
import StatIcon from "@/components/ui/StatIcon.vue";

const { state, handleConfirm, handleCancel } = useConfirmDialogState();

const ICON_CLASSES: Record<string, string> = {
  danger: "bg-red-100 text-red-600",
  warn: "bg-amber-100 text-amber-600",
};

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") handleCancel();
}

watch(
  () => state.open,
  (open) => {
    if (open) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
);
</script>

<template>
  <div
    v-if="state.open"
    class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4 py-6"
    @click.self="handleCancel"
  >
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" :class="ICON_CLASSES[state.tone]">
          <span class="h-5 w-5"><StatIcon name="alert" /></span>
        </div>
        <div class="min-w-0 flex-1 pt-1">
          <h2 class="font-display text-lg font-bold text-brand-800">{{ state.title }}</h2>
          <!-- `whitespace-pre-line`: algunos mensajes listan varias líneas (ej. las citas
               que una ausencia va a cancelar); los de una sola línea no cambian. -->
          <p class="mt-1 whitespace-pre-line text-sm text-slate-500">{{ state.message }}</p>
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <Button variant="secondary" @click="handleCancel">{{ state.cancelLabel }}</Button>
        <Button :variant="state.tone === 'danger' ? 'danger' : 'primary'" @click="handleConfirm">{{ state.confirmLabel }}</Button>
      </div>
    </div>
  </div>
</template>
