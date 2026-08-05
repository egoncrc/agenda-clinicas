<script setup lang="ts">
import { onMounted, ref } from "vue";
import { updateUser } from "@directus/sdk";
import Button from "@/components/ui/Button.vue";
import CredentialBlock from "@/components/clinics/CredentialBlock.vue";
import { directus } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { randomPassword } from "@/lib/passwords";
import { useConfirm } from "@/composables/useConfirm";

/**
 * Restablece la contraseña de un usuario del panel desde la vista de admin.
 * Es el respaldo del flujo por correo: sirve aunque el SMTP falle o la persona
 * no tenga acceso a su buzón.
 */
const props = defineProps<{ userId: string; nombre: string; email: string }>();
const emit = defineEmits<{ close: []; done: [] }>();

const confirm = useConfirm();

const working = ref(true);
const error = ref<string | null>(null);
const generated = ref<string | null>(null);

onMounted(run);

async function run(): Promise<void> {
  const ok = await confirm({
    title: "Restablecer contraseña",
    message: `Se genera una contraseña temporal para "${props.nombre}". La actual deja de funcionar de inmediato y tendrá que definir una nueva al ingresar.`,
    confirmLabel: "Restablecer",
    tone: "warn",
  });
  if (!ok) {
    emit("close");
    return;
  }

  const temp = randomPassword();
  try {
    // Un solo PATCH con los dos campos. `force-password-change-hook` respeta un
    // `must_change_password` explícito justamente para esto: si vinieran en dos
    // escrituras separadas, el hook apagaría la bandera al ver el cambio de
    // contraseña y el reset quedaría sin efecto.
    await directus.request(
      updateUser(props.userId as never, { password: temp, must_change_password: true } as never),
    );
    generated.value = temp;
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo restablecer la contraseña.");
  } finally {
    working.value = false;
  }
}

function finish(): void {
  emit("done");
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display text-base font-semibold text-slate-900">Restablecer contraseña</h2>
      <p class="mt-1 text-sm text-slate-500">{{ props.nombre }}</p>

      <div v-if="working" class="mt-6 flex items-center gap-2 text-sm text-slate-500">
        <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
        Generando…
      </div>

      <p v-else-if="error" class="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
        {{ error }}
      </p>

      <div v-else-if="generated" class="mt-6 space-y-4">
        <CredentialBlock :email="props.email" :password="generated" />
        <p class="text-xs text-slate-500">
          Pasásela por un canal seguro. Al ingresar, el sistema le va a pedir que defina una contraseña propia.
        </p>
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <Button v-if="!working && !generated" variant="secondary" @click="emit('close')">Cerrar</Button>
        <Button v-if="generated" @click="finish">Listo</Button>
      </div>
    </div>
  </div>
</template>
