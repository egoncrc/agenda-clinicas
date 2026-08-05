<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 py-10 text-center">
    <div class="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
      <slot name="icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
          <rect x="3" y="5" width="18" height="15" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 3v4M16 3v4" />
        </svg>
      </slot>
    </div>
    <p class="text-sm font-medium text-slate-600">{{ title }}</p>
    <p v-if="description" class="text-xs text-slate-400">{{ description }}</p>
    <slot name="action" />
  </div>
</template>
