import { defineHook } from "@directus/extensions-sdk";
import { UserSuspendedError } from "@directus/errors";

/**
 * Directus, por diseño, devuelve el mismo InvalidCredentialsError tanto para
 * clave incorrecta como para clave correcta + cuenta suspendida (protección
 * anti-enumeración de cuentas) — el filter `auth.login` corre ANTES de
 * validar la clave, así que este hook no puede (ni debe) confirmar la clave
 * él mismo: reimplementar esa verificación sería duplicar código de
 * seguridad sensible de Directus. Se acepta la fuga mínima resultante (que
 * el correo de una cuenta Doctor/Receptionist existe y está inactiva, nunca
 * la clave) a cambio de un mensaje claro para el panel.
 *
 * Acotado a propósito a los roles Doctor/Receptionist de esta clínica: esta
 * instancia de Directus es compartida con otros productos no relacionados
 * (ver CLAUDE.md, "PassKit/Google-OAuth") — nunca debe tocar Administrator
 * ni ninguna cuenta ajena a este proyecto.
 */
const SCOPED_ROLE_IDS = new Set([
  "c0fee466-d8c2-4843-a14f-17e750755cc8", // Doctor
  "415635f3-5246-48ec-93fc-0dc4b0ae7f18", // Receptionist
]);

interface AuthLoginMeta {
  status?: string;
  user?: string;
}

export default defineHook(({ filter }, { database }) => {
  filter<Record<string, unknown>>("auth.login", async (payload, rawMeta) => {
    const meta = rawMeta as AuthLoginMeta;
    if (meta.status !== "pending" || !meta.user) return payload;

    const user = await database("directus_users")
      .select("status", "role")
      .where({ id: meta.user })
      .first();

    if (user && SCOPED_ROLE_IDS.has(user.role) && user.status !== "active") {
      throw new UserSuspendedError();
    }

    return payload;
  });
});
