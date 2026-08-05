<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div v-if="title || $slots.icon || $slots.action" class="mb-4 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <slot name="icon" />
        <h2 v-if="title" class="text-sm font-semibold text-slate-700">{{ title }}</h2>
      </div>
      <slot name="action" />
    </div>
    <slot />
  </section>
</template>
