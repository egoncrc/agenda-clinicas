<script setup lang="ts">
defineProps<{ name: "edit" | "trash" | "whatsapp" }>();
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full">
    <template v-if="name === 'edit'">
      <path d="M4 20h4L18.5 9.5a2.121 2.121 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4 7h16" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </template>
    <template v-else-if="name === 'whatsapp'">
      <path d="M3.5 20.5l1.25-3.65a8 8 0 1 1 3 2.95l-4.25.7z" />
      <path d="M9 9.6c0 3 2.4 5.4 5.4 5.4.55 0 1-.45 1-1v-.75l-1.95-.8-.85.95a6.5 6.5 0 0 1-2.4-2.4l.95-.85-.8-1.95H10c-.55 0-1 .45-1 1z" />
    </template>
  </svg>
</template>
