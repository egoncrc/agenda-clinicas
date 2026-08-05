import "dotenv/config";
import { z } from "zod";

/** Trata una variable de entorno vacía ("") como no configurada (undefined). */
const optionalString = () =>
  z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

/**
 * Carga y valida la configuración desde variables de entorno.
 * Falla rápido al arrancar si falta algo crítico.
 */
const schema = z.object({
  DIRECTUS_URL: z.string().url(),
  DIRECTUS_TOKEN: z.string().min(1),

  YCLOUD_API_KEY: optionalString(),
  YCLOUD_WEBHOOK_SECRET: optionalString(),
  WHATSAPP_FROM: optionalString(),
  YCLOUD_WABA_ID: optionalString(),

  ANTHROPIC_API_KEY: optionalString(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  PORT: z.coerce.number().int().positive().default(3000),
  CLINIC_TIMEZONE: z.string().default("America/Costa_Rica"),
  SLOT_STEP_MINUTES: z.coerce.number().int().positive().default(15),

  REMINDERS_ENABLED: z.preprocess((v) => v === "true", z.boolean()).default(false),
  REMINDER_CHECK_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),

  // ---- Lista de espera: asignación automática de cupos liberados ----
  WAITLIST_ENABLED: z.preprocess((v) => v === "true", z.boolean()).default(false),
  WAITLIST_CHECK_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  // Cuántos días hacia adelante se busca un hueco compatible con cada entrada.
  WAITLIST_SEARCH_HORIZON_DAYS: z.coerce.number().int().positive().default(30),
  // Secreto compartido entre el bot y la extensión de Directus (mismo host,
  // 127.0.0.1) para que el hook de "cita modificada" pueda disparar el
  // barrido de lista de espera vía POST /internal/waitlist/run sin exponer
  // ese endpoint a cualquiera.
  INTERNAL_API_SECRET: optionalString(),

  // ---- Agendamiento público sin login (link único, envío manual mientras no hay bot activo) ----
  // Token estático compartido: el link es "<BOOKING_LINK_BASE_URL>?token=<este valor>".
  // No es por-paciente ni vence; es un secreto compartido para que solo quien
  // tenga el link pueda usar la API, no cualquiera en internet.
  BOOKING_PUBLIC_LINK_TOKEN: optionalString(),
  // Orígenes permitidos para la API pública de agendamiento (CORS), separados por coma.
  PUBLIC_BOOKING_CORS_ORIGINS: z
    .string()
    .default("https://panel.egonia.site,http://localhost:5173"),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);
