<script setup lang="ts">
import { RouterView, useRoute } from "vue-router";
import AppLayout from "@/components/AppLayout.vue";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";
import SessionWarningModal from "@/components/ui/SessionWarningModal.vue";
import { useIdleTimeout } from "@/composables/useIdleTimeout";

const route = useRoute();
useIdleTimeout();
</script>

<template>
  <AppLayout v-if="!route.meta.public && !route.meta.bare" />
  <RouterView v-else />
  <ConfirmDialog />
  <SessionWarningModal />
</template>
