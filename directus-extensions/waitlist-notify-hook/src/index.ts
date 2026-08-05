import { defineHook } from "@directus/extensions-sdk";

/**
 * URL del endpoint interno del bot (mismo host, ver CLAUDE.md: Directus y el
 * bot corren en el mismo droplet) y secreto compartido — deben coincidir con
 * WAITLIST_NOTIFY_URL/INTERNAL_API_SECRET del `.env` de Directus y con
 * INTERNAL_API_SECRET del `.env` del bot respectivamente. Sin secreto
 * configurado, el hook no dispara nada (el bot tampoco lo aceptaría).
 */
const NOTIFY_URL = process.env.WAITLIST_NOTIFY_URL ?? "http://127.0.0.1:3000/internal/waitlist/run";
const SECRET = process.env.INTERNAL_API_SECRET;

/**
 * Avisa al bot para que corra el barrido de lista de espera. Fire-and-forget:
 * un fallo aquí no debe afectar la escritura de la cita que lo disparó (el
 * barrido periódico de respaldo del bot igual lo cubre más tarde).
 */
async function notifyWaitlist(): Promise<void> {
  if (!SECRET) return;
  try {
    await fetch(NOTIFY_URL, { method: "POST", headers: { "X-Internal-Secret": SECRET } });
  } catch (err) {
    console.error("[waitlist-notify-hook] Error notificando al bot:", err);
  }
}

/**
 * Cualquier cambio en una cita (cancelación, reprogramación, marca como
 * no_show, borrado) puede liberar un cupo, así que se notifica siempre en
 * vez de intentar diferenciar el caso exacto aquí — el bot es quien decide
 * qué hacer con eso (recalcula disponibilidad real). A diferencia del hook
 * `appointments-overlap-guard` (que usa `filter`, antes de escribir, para
 * poder rechazar), este usa `action` (después de escribir): no debe ni puede
 * bloquear la escritura de la cita.
 */
export default defineHook(({ action }) => {
  action("appointments.items.update", () => {
    void notifyWaitlist();
  });
  action("appointments.items.delete", () => {
    void notifyWaitlist();
  });
});
