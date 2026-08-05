import { authentication, createDirectus, rest, updateMe } from "@directus/sdk";

const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_URL as string;

/**
 * Cliente EFÍMERO para verificar la contraseña actual sin tocar la sesión viva.
 *
 * - `mode: "json"`: Directus devuelve los tokens en el cuerpo y no emite la
 *   cookie de sesión, así que la sesión del panel no se rota.
 * - `credentials: "omit"`: el navegador ni manda la cookie actual ni guardaría
 *   una que llegara en la respuesta. Ésta es la garantía REAL — no depende de
 *   qué haga el servidor, sino de la fetch spec.
 * - `autoRefresh: false`: no deja timers vivos ni intenta refrescar nada.
 * - Cliente NUEVO por llamada, con su propio almacenamiento en memoria: no
 *   comparte estado con el singleton de `lib/directus.ts`.
 */
function ephemeralClient() {
  return createDirectus(DIRECTUS_URL)
    .with(authentication("json", { autoRefresh: false, credentials: "omit" }))
    .with(rest({ credentials: "omit" }));
}

/**
 * Verifica `currentPassword` re-autenticando y, si es correcta, escribe la nueva
 * con el token efímero.
 *
 * Por qué no reusar el singleton de `lib/directus.ts` para "probar" la contraseña:
 *
 * 1. Login exitoso en modo `session` emitiría un `Set-Cookie` NUEVO y crearía
 *    otra fila en `directus_sessions`; la sesión vieja quedaría huérfana hasta
 *    expirar. Estado sucio cada vez que alguien cambia su clave.
 * 2. Login fallido: hoy la sesión sobrevive porque el SDK hace `resetStorage()`
 *    DESPUÉS del request y un 401 no trae `Set-Cookie` — pero eso es una
 *    garantía incidental, dependiente del orden interno de una dependencia
 *    minificada, que se rompe en un bump de versión sin que nada lo note.
 *    `credentials: "omit"` la vuelve estructural.
 * 3. Directus aplica rate limit a `/auth/login`. Varios intentos fallidos con la
 *    contraseña actual pueden bloquear el login en sí, no solo el cambio; de ahí
 *    el freno tras varios fallos en las pantallas que llaman a esto.
 *
 * El `logout` del `finally` revoca la sesión efímera: sin él, cada cambio de
 * contraseña dejaría una fila viva en `directus_sessions`.
 */
export async function changePasswordWithVerification(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const client = ephemeralClient();
  // Lanza si la contraseña actual es incorrecta: es la verificación.
  await client.login({ email, password: currentPassword }, { mode: "json" });
  try {
    await client.request(updateMe({ password: newPassword } as never));
  } finally {
    await client.logout({ mode: "json" }).catch(() => {
      // La sesión efímera expira sola; no vale la pena molestar al usuario.
    });
  }
}
