<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { updateMe } from "@directus/sdk";
import ChangePasswordForm from "@/components/ChangePasswordForm.vue";
import Button from "@/components/ui/Button.vue";
import { directus } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useAuthStore } from "@/stores/auth";

/**
 * Pantalla trampa del primer ingreso: el router manda acá a todo usuario con
 * `must_change_password` y no lo deja ir a otro lado hasta que defina una
 * contraseña propia. La temporal la asignó el wizard de alta o el botón de
 * "Restablecer contraseña" del admin.
 */
const auth = useAuthStore();
const router = useRouter();

/** Se activa si el cambio funcionó pero la bandera sigue puesta: el hook de Directus no está desplegado. */
const flagStuck = ref(false);
const overriding = ref(false);
const overrideError = ref<string | null>(null);

async function onChanged(): Promise<void> {
  if (auth.mustChangePassword) {
    flagStuck.value = true;
    return;
  }
  await router.push("/");
}

async function onSessionLost(): Promise<void> {
  await auth.logout().catch(() => {});
  await router.push({ name: "login", query: { cambiada: "1" } });
}

async function handleLogout(): Promise<void> {
  await auth.logout();
  await router.push({ name: "login" });
}

/**
 * Válvula de escape solo para admin: un usuario con `admin_access` sí puede
 * escribir el campo, así que la cuenta Administrator nunca queda encerrada
 * aunque `force-password-change-hook` esté caído.
 */
async function overrideFlag(): Promise<void> {
  overriding.value = true;
  overrideError.value = null;
  try {
    await directus.request(updateMe({ must_change_password: false } as never));
    await auth.loadUser();
    await router.push("/");
  } catch (e) {
    overrideError.value = friendlyErrorMessage(e, "No se pudo continuar. Hay que desplegar la extensión.");
  } finally {
    overriding.value = false;
  }
}
</script>

<template>
  <div
    class="flex min-h-screen flex-col justify-center bg-slate-50 px-6 py-12"
    style="background-image: radial-gradient(circle at 1px 1px, rgb(226 232 240) 1px, transparent 0); background-size: 24px 24px"
  >
    <div class="mx-auto w-full max-w-sm">
      <div class="mb-10 flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 text-white">
            <rect x="3" y="5" width="18" height="15" rx="2" />
            <path d="M3 10h18" />
            <path d="M8 3v4M16 3v4" />
            <path d="M12 13.5v4M10 15.5h4" />
          </svg>
        </div>
        <span class="font-display text-base font-semibold text-brand-800">Agenda Médica</span>
      </div>

      <h1 class="font-display text-2xl font-bold text-slate-900">Definí tu contraseña</h1>
      <p class="mt-2 text-sm text-slate-500">
        Por seguridad, tenés que reemplazar la contraseña temporal por una propia antes de entrar al panel.
      </p>

      <div v-if="flagStuck" class="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p>
          Tu contraseña se cambió correctamente, pero el sistema no pudo registrarlo. Avisá al administrador: falta
          desplegar <code class="font-mono text-xs">force-password-change-hook</code> en Directus.
        </p>
        <div v-if="auth.isAdmin" class="mt-3">
          <Button variant="secondary" size="sm" :loading="overriding" @click="overrideFlag">Continuar igual</Button>
          <p v-if="overrideError" class="mt-2 text-xs text-red-700">{{ overrideError }}</p>
        </div>
      </div>

      <div class="mt-8">
        <ChangePasswordForm
          current-label="Contraseña temporal"
          submit-label="Guardar y entrar"
          @changed="onChanged"
          @session-lost="onSessionLost"
        />
      </div>

      <!-- Sin esta salida, quien no recuerda su temporal queda encerrado en la pestaña. -->
      <p class="mt-8 text-center text-xs text-slate-400">
        ¿No es tu cuenta o no recordás la temporal?
        <button type="button" class="font-medium text-brand-600 hover:text-brand-800" @click="handleLogout">
          Cerrar sesión
        </button>
      </p>
    </div>
  </div>
</template>
