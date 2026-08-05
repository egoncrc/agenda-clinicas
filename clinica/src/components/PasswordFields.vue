<script setup lang="ts">
import { computed, watchEffect } from "vue";
import { PASSWORD_RULES, passwordProblems } from "@/lib/passwordPolicy";

/**
 * Los dos campos de "contraseña nueva" + "repetir" con la lista de reglas en
 * vivo. Lo comparten las tres pantallas de cambio (perfil, cambio obligatorio,
 * restablecer por correo) para no triplicar la validación.
 *
 * El padre decide qué hacer con `valid`: acá no hay submit ni llamadas de red.
 */
const password = defineModel<string>("password", { required: true });
const confirmation = defineModel<string>("confirmation", { required: true });
const showPassword = defineModel<boolean>("show", { default: false });
/** Solo de salida: el padre lo lee con `v-model:valid` para habilitar su botón de guardar. */
const valid = defineModel<boolean>("valid", { default: false });

const props = withDefaults(defineProps<{ label?: string; autocomplete?: string }>(), {
  label: "Contraseña nueva",
  autocomplete: "new-password",
});

const rules = computed(() => PASSWORD_RULES.map((r) => ({ label: r.label, ok: r.ok(password.value) })));
const mismatch = computed(() => confirmation.value.length > 0 && confirmation.value !== password.value);

watchEffect(() => {
  valid.value = passwordProblems(password.value).length === 0 && confirmation.value === password.value;
});
</script>

<template>
  <div class="space-y-4">
    <div>
      <div class="mb-1.5 flex items-center justify-between">
        <label for="new-password" class="block text-sm font-medium text-slate-700">{{ props.label }}</label>
        <button
          type="button"
          class="text-xs font-medium text-brand-600 hover:text-brand-800"
          @click="showPassword = !showPassword"
        >
          {{ showPassword ? "Ocultar" : "Mostrar" }}
        </button>
      </div>
      <input
        id="new-password"
        v-model="password"
        :type="showPassword ? 'text' : 'password'"
        required
        :autocomplete="props.autocomplete"
        placeholder="••••••••"
        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      />
    </div>

    <ul class="space-y-1">
      <li v-for="rule in rules" :key="rule.label" class="flex items-center gap-2 text-xs">
        <svg
          v-if="rule.ok"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-3.5 w-3.5 flex-none text-emerald-600"
        >
          <path d="m5 12.5 4.5 4.5L19 7" />
        </svg>
        <span v-else class="h-3.5 w-3.5 flex-none rounded-full border border-slate-300"></span>
        <span :class="rule.ok ? 'text-emerald-700' : 'text-slate-500'">{{ rule.label }}</span>
      </li>
    </ul>

    <div>
      <label for="confirm-password" class="mb-1.5 block text-sm font-medium text-slate-700">
        Repetir contraseña
      </label>
      <input
        id="confirm-password"
        v-model="confirmation"
        :type="showPassword ? 'text' : 'password'"
        required
        :autocomplete="props.autocomplete"
        placeholder="••••••••"
        class="w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:outline-none focus:ring-2"
        :class="
          mismatch
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500/30'
            : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/30'
        "
      />
      <p v-if="mismatch" class="mt-1.5 text-xs text-red-600">Las contraseñas no coinciden.</p>
    </div>
  </div>
</template>
