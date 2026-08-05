<script setup lang="ts">
defineProps<{ name: "dashboard" | "calendar" | "clock" | "flag" | "list" | "message" | "logout" | "building" | "users" | "chart" }>();
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full">
    <template v-if="name === 'dashboard'">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </template>
    <template v-else-if="name === 'calendar'">
      <rect x="3" y="5" width="18" height="15" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
    </template>
    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </template>
    <template v-else-if="name === 'flag'">
      <path d="M5 3v18" />
      <path d="M5 4h11l-2 3 2 3H5z" />
    </template>
    <template v-else-if="name === 'list'">
      <circle cx="5" cy="6" r="1" fill="currentColor" stroke="none" />
      <path d="M9 6h10" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M9 12h10" />
      <circle cx="5" cy="18" r="1" fill="currentColor" stroke="none" />
      <path d="M9 18h10" />
    </template>
    <template v-else-if="name === 'message'">
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5h.5a8.5 8.5 0 0 1 8 8z" />
    </template>
    <template v-else-if="name === 'building'">
      <rect x="4" y="3" width="12" height="18" rx="1" />
      <path d="M9 21v-4h2v4M8 7h1M11 7h1M8 11h1M11 11h1M8 15h1M11 15h1" />
      <path d="M16 10h4v11h-4" />
    </template>
    <template v-else-if="name === 'users'">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20v-1a6 6 0 0 1 12 0v1" />
      <path d="M16.5 5.5a3 3 0 0 1 0 5.8" />
      <path d="M18 20v-1a5.5 5.5 0 0 0-2-4.2" />
    </template>
    <template v-else-if="name === 'chart'">
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7" y="12" width="3" height="5" rx="0.5" />
      <rect x="12" y="8" width="3" height="9" rx="0.5" />
      <rect x="17" y="5" width="3" height="12" rx="0.5" />
    </template>
    <template v-else-if="name === 'logout'">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </template>
  </svg>
</template>
