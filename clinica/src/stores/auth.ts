import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { passwordRequest, passwordReset, readItems, readMe } from "@directus/sdk";
import { directus } from "@/lib/directus";
import { changePasswordWithVerification } from "@/lib/reauth";
import { friendlyErrorMessage, loginErrorMessage } from "@/lib/directusErrors";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";

/**
 * A dónde apunta el enlace del correo de recuperación. Debe coincidir EXACTAMENTE
 * con una entrada de `PASSWORD_RESET_URL_ALLOW_LIST` en el docker-compose de
 * Directus (el match es literal: una barra final de más y devuelve 400).
 *
 * Va por env var y no solo por `window.location.origin` porque el dev server se
 * corre con `--host` para probar desde el móvil, y ahí el origin es una IP de
 * LAN que nunca va a estar en la allow-list.
 */
const PASSWORD_RESET_URL =
  (import.meta.env.VITE_PASSWORD_RESET_URL as string | undefined) ||
  `${window.location.origin}/restablecer`;

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roleName: string | null;
  /** `admin_access` del rol Directus — no depende del nombre del rol (que se puede renombrar). */
  isAdmin: boolean;
  /** Campo custom `directus_users.must_change_password`: la contraseña actual es una temporal. */
  mustChangePassword: boolean;
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<CurrentUser | null>(null);
  /** Si el usuario logueado tiene una fila en `doctors` vinculada (rol Médico), su id. */
  const ownDoctorId = ref<string | null>(null);
  /** true una vez que se resolvió si hay sesión activa o no (evita parpadeo al cargar la app). */
  const ready = ref(false);
  const loginError = ref<string | null>(null);

  const isAuthenticated = computed(() => user.value !== null);
  const isReceptionist = computed(() => user.value?.roleName === "Receptionist");
  /** Da acceso al wizard de alta de clínica (`/admin/clinicas`) — cualquier rol con `admin_access`, no solo un nombre fijo. */
  const isAdmin = computed(() => user.value?.isAdmin === true);
  /** El router lo usa para atrapar al usuario en `/cambiar-clave` hasta que defina una contraseña propia. */
  const mustChangePassword = computed(() => user.value?.mustChangePassword === true);

  async function loadUser(): Promise<void> {
    // `admin_access` vive en la Policy, no en el Role (ver CLAUDE.md, "Directus
    // permissions model"). Un usuario puede admin_access via una policy en su
    // Role o una vinculada a él directamente, así que se revisan ambos caminos.
    // Deep fields con dot-path no están en el tipo estricto de `fields` del SDK
    // (mismo hueco de tipado ya documentado en `lib/queryHelpers.ts`).
    type PolicyLink = { policy?: { admin_access?: boolean } };
    /** Forma real de la respuesta: los dot-path y el campo custom no están en el tipo del SDK. */
    type MeRow = {
      id: string;
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      role?: { name?: string; policies?: PolicyLink[] } | null;
      policies?: PolicyLink[];
      must_change_password?: boolean | null;
    };

    let me: MeRow;
    try {
      me = (await directus.request(
        readMe({
          fields: [
            "id",
            "email",
            "first_name",
            "last_name",
            "role.name" as never,
            "role.policies.policy.admin_access" as never,
            "policies.policy.admin_access" as never,
            // Campo custom, creado por scripts/provision-password-management.ts.
            "must_change_password" as never,
          ],
        }),
      )) as unknown as MeRow;
    } catch {
      // Si el campo todavía no existe en Directus (panel desplegado antes de
      // correr `npm run provision:passwords`, o rollback del script), pedirlo
      // haría fallar TODO el readMe y nadie podría entrar al panel. Se reintenta
      // sin él: se pierde el forzado de cambio de contraseña, no el acceso. Un
      // fallo real (red, permisos) vuelve a fallar acá y propaga igual.
      me = (await directus.request(
        readMe({
          fields: [
            "id",
            "email",
            "first_name",
            "last_name",
            "role.name" as never,
            "role.policies.policy.admin_access" as never,
            "policies.policy.admin_access" as never,
          ],
        }),
      )) as unknown as MeRow;
    }

    const extra = me;
    const roleName = extra.role?.name ?? null;
    const adminAccess = [...(extra.role?.policies ?? []), ...(extra.policies ?? [])].some(
      (p) => p.policy?.admin_access === true,
    );

    user.value = {
      id: me.id,
      email: me.email ?? "",
      firstName: me.first_name ?? null,
      lastName: me.last_name ?? null,
      roleName,
      isAdmin: adminAccess,
      // `=== true` y no `!== false`: una cuenta anterior al campo puede traerlo
      // `null`, y eso no debe atrapar a nadie en la pantalla de cambio forzado.
      // Mismo criterio defensivo que los flags de `appointments` en lib/directus.ts.
      mustChangePassword: extra.must_change_password === true,
    };

    // Identidad global del médico: una sola fila `doctors` por persona, aunque
    // trabaje en varias clínicas (eso vive en `clinics_doctors`). No hace falta
    // recalcularlo al cambiar de clínica activa.
    const doctorRows = await directus.request(
      readItems("doctors", { filter: { usuario: { _eq: me.id } }, limit: 1, fields: ["id"] }),
    );
    ownDoctorId.value = doctorRows[0]?.id ?? null;

    await useClinicaStore().loadClinics();
  }

  async function login(email: string, password: string): Promise<void> {
    loginError.value = null;
    // Por si se cambia de cuenta sin pasar por logout(): evita arrastrar la
    // caché (y los permisos) del usuario anterior en la misma pestaña.
    useCatalogStore().reset();
    useClinicaStore().reset();

    // Dos try separados a propósito: hasta ahora un fallo de `loadUser()` (403
    // de permisos, red caída) se reportaba como "correo o contraseña
    // incorrectos", mandando al usuario a resetear una contraseña que estaba
    // bien. Con `must_change_password` sumado al readMe, un permiso mal
    // configurado en `directus_users` cae justo por ahí.
    try {
      await directus.login({ email, password }, { mode: "session" });
    } catch (e) {
      loginError.value = loginErrorMessage(e);
      throw new Error("login-failed");
    }

    try {
      await loadUser();
    } catch (e) {
      loginError.value = friendlyErrorMessage(
        e,
        "Ingresaste correctamente, pero no se pudo cargar tu perfil. Avisá al administrador.",
      );
      throw new Error("profile-load-failed");
    }
  }

  async function logout(): Promise<void> {
    await directus.logout();
    user.value = null;
    ownDoctorId.value = null;
    useCatalogStore().reset();
    useClinicaStore().reset();
  }

  /**
   * Cambia la contraseña del usuario logueado verificando primero la actual.
   *
   * La verificación y la escritura van por un cliente efímero (ver `lib/reauth.ts`),
   * no por la cookie de sesión — así un intento fallido no puede tumbar la
   * sesión abierta, que es justo el requisito.
   *
   * Lanza `Error("session-lost")` si la contraseña ya se cambió pero la sesión
   * de cookie no sobrevivió (Directus puede invalidar las demás sesiones al
   * cambiar la contraseña). La vista lo trata como éxito y manda a `/login`: el
   * cambio nunca se pierde en silencio.
   */
  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const email = user.value?.email;
    if (!email) throw new Error("no-session");

    await changePasswordWithVerification(email, currentPassword, newPassword);

    // Optimista: si `force-password-change-hook` no está desplegado, al menos
    // esta sesión no queda atrapada en la pantalla de cambio forzado.
    if (user.value) user.value.mustChangePassword = false;

    try {
      // Y la verdad del servidor: el hook ya debería haber apagado la bandera.
      await loadUser();
    } catch {
      throw new Error("session-lost");
    }
  }

  /** Pide a Directus el correo con el enlace de restablecimiento. Endpoint público, no toca la sesión. */
  async function requestPasswordReset(email: string): Promise<void> {
    await directus.request(passwordRequest(email, PASSWORD_RESET_URL));
  }

  /** Consume el token del correo. Endpoint público, no toca la sesión. */
  async function resetPassword(token: string, password: string): Promise<void> {
    await directus.request(passwordReset(token, password));
  }

  /** Se llama una vez al arrancar la app: revisa si ya hay una sesión de cookie válida. */
  async function checkSession(): Promise<void> {
    try {
      await loadUser();
    } catch {
      user.value = null;
      ownDoctorId.value = null;
    } finally {
      ready.value = true;
    }
  }

  return {
    user,
    ownDoctorId,
    ready,
    loginError,
    isAuthenticated,
    isReceptionist,
    isAdmin,
    mustChangePassword,
    login,
    logout,
    checkSession,
    changePassword,
    requestPasswordReset,
    resetPassword,
    loadUser,
  };
});
