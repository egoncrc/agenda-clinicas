<script setup lang="ts">
import { RouterView, useRoute } from "vue-router";
import AppLayout from "@/components/AppLayout.vue";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";

const route = useRoute();
</script>

<template>
  <AppLayout v-if="!route.meta.public && !route.meta.bare" />
  <RouterView v-else />
  <ConfirmDialog />
</template>
