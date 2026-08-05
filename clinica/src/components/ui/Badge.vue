<script setup lang="ts">
withDefaults(defineProps<{ tone?: "success" | "warn" | "danger" | "neutral" | "info" }>(), { tone: "neutral" });

const TONE_CLASSES: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
  neutral: "bg-slate-200 text-slate-600",
  info: "bg-sky-100 text-sky-700",
};
</script>

<template>
  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" :class="TONE_CLASSES[tone]">
    <slot />
  </span>
</template>
