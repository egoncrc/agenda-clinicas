import { config } from "./config.js";
import { listActiveClinics } from "./repositories/clinics.js";
import { runReminderJob } from "./repositories/reminders.js";
import { runWaitlistMatchingJob } from "./repositories/waitlist.js";

/** Revisa periódicamente, para cada clínica activa, las citas con recordatorio pendiente y las envía. */
export function startReminderScheduler(): void {
  const intervalMs = config.REMINDER_CHECK_INTERVAL_MINUTES * 60_000;
  setInterval(() => {
    void (async () => {
      try {
        for (const clinic of await listActiveClinics()) {
          await runReminderJob(clinic).catch((err: unknown) => {
            console.error(`Error en el job de recordatorios (clínica ${clinic.id}):`, err);
          });
        }
      } catch (err) {
        console.error("Error listando clínicas activas para el job de recordatorios:", err);
      }
    })();
  }, intervalMs);
}

/**
 * Barrido periódico de respaldo de la lista de espera, por cada clínica
 * activa: complementa el disparo inmediato por evento (hook de Directus ->
 * POST /internal/waitlist/run en server.ts) para cubrir casos que ese evento
 * no capture (hook caído, cambios de horario laboral/ausencias que liberan
 * cupos sin tocar una cita).
 */
export function startWaitlistScheduler(): void {
  const intervalMs = config.WAITLIST_CHECK_INTERVAL_MINUTES * 60_000;
  setInterval(() => {
    void (async () => {
      try {
        for (const clinic of await listActiveClinics()) {
          await runWaitlistMatchingJob(clinic).catch((err: unknown) => {
            console.error(`Error en el job de lista de espera (barrido periódico, clínica ${clinic.id}):`, err);
          });
        }
      } catch (err) {
        console.error("Error listando clínicas activas para el job de lista de espera:", err);
      }
    })();
  }, intervalMs);
}
