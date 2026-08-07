<script setup lang="ts">
/**
 * Iconos del catálogo de reportes. Se acepta cualquier string y se cae en uno
 * genérico si no hay coincidencia: un reporte nuevo con un icono no previsto
 * debe verse algo raro, no romper la pantalla.
 */
defineProps<{ name: string }>();
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="h-full w-full"
  >
    <template v-if="name === 'gauge'">
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4.5-5" />
      <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'x'">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </template>
    <template v-else-if="name === 'alert'">
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'chart'">
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16l3.5-4 3 2.5L20 7" />
    </template>
    <template v-else-if="name === 'list'">
      <circle cx="5" cy="6" r="1" fill="currentColor" stroke="none" />
      <path d="M9 6h10" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M9 12h10" />
      <circle cx="5" cy="18" r="1" fill="currentColor" stroke="none" />
      <path d="M9 18h10" />
    </template>
    <template v-else-if="name === 'pie'">
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M14 3.5A9 9 0 0 1 20.5 10H14z" />
    </template>
    <template v-else-if="name === 'users'">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20v-1a6 6 0 0 1 12 0v1" />
      <path d="M16.5 5.5a3 3 0 0 1 0 5.8" />
      <path d="M18 20v-1a5.5 5.5 0 0 0-2-4.2" />
    </template>
    <template v-else-if="name === 'map'">
      <path d="M9 3L3 5.5v15L9 18l6 3 6-2.5v-15L15 6z" />
      <path d="M9 3v15M15 6v15" />
    </template>
    <template v-else-if="name === 'calendar'">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" />
    </template>
    <template v-else>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </template>
  </svg>
</template>
