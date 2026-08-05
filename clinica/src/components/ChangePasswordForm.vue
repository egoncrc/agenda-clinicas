<script setup lang="ts">
import { computed, ref } from "vue";
import PasswordFields from "@/components/PasswordFields.vue";
import Button from "@/components/ui/Button.vue";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useAuthStore } from "@/stores/auth";

/**
 * Formulario de cambio de contraseña del usuario logueado: contraseña actual +
 * nueva + repetir. Lo comparten `/perfil` (cambio voluntario) y `/cambiar-clave`
 * (cambio obligatorio del primer ingreso).
 *
 * No navega: emite `changed` cuando el cambio se completó y la sesión sigue viva,
 * y `session-lost` cuando la contraseña YA se cambió pero la sesión de cookie no
 * sobrevivió. Cada pantalla decide a dónde ir.
 */
const emit = defineEmits<{ changed: []; "session-lost": [] }>();

withDefaults(defineProps<{ currentLabel?: string; submitLabel?: string }>(), {
  currentLabel: "Contraseña actual",
  submitLabel: "Cambiar contraseña",
});

const auth = useAuthStore();

const current = ref("");
const password = ref("");
const confirmation = ref("");
const showPassword = ref(false);
const valid = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

/**
 * Directus aplica rate limit a `/auth/login`, y la verificación de la contraseña
 * actual es un login. Varios intentos fallidos seguidos pueden bloquear el login
 * en sí, no solo el cambio — de ahí el freno.
 */
const failures = ref(0);
const throttled = computed(() => failures.value >= 3);

const canSubmit = computed(() => valid.value && current.value.length > 0 && !throttled.value);

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  error.value = null;
  try {
    await auth.changePassword(current.value, password.value);
    reset();
    emit("changed");
  } catch (e) {
    if (e instanceof Error && e.message === "session-lost") {
      // La contraseña sí se cambió: no es un fallo que el usuario deba reintentar.
      reset();
      emit("session-lost");
      return;
    }
    failures.value += 1;
    // Deliberadamente no afirma cuál dato está mal: si un admin le cambió el
    // correo en otra sesión, la re-autenticación falla sin que la contraseña
    // actual sea incorrecta, y decírselo sería mentira.
    error.value = friendlyErrorMessage(e, "No pudimos verificar tu contraseña actual. Revisá e intentá de nuevo.");
  } finally {
    submitting.value = false;
  }
}

function reset(): void {
  current.value = "";
  password.value = "";
  confirmation.value = "";
  failures.value = 0;
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="handleSubmit">
    <div>
      <label for="current-password" class="mb-1.5 block text-sm font-medium text-slate-700">
        {{ currentLabel }}
      </label>
      <input
        id="current-password"
        v-model="current"
        :type="showPassword ? 'text' : 'password'"
        required
        autocomplete="current-password"
        placeholder="••••••••"
        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      />
    </div>

    <PasswordFields
      v-model:password="password"
      v-model:confirmation="confirmation"
      v-model:show="showPassword"
      v-model:valid="valid"
    />

    <p v-if="error" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      {{ error }}
    </p>
    <p v-if="throttled" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
      Demasiados intentos fallidos. Esperá unos segundos y recargá la página antes de volver a probar, o usá
      <RouterLink to="/recuperar-clave" class="font-medium underline">recuperar contraseña</RouterLink>.
    </p>

    <Button type="submit" :loading="submitting" :disabled="!canSubmit" class="w-full">
      {{ submitting ? "Guardando…" : submitLabel }}
    </Button>
  </form>
</template>
