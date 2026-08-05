import { readItems } from "@directus/sdk";
import { directus, type ClinicRow } from "../directus.js";

/** Clínicas activas (para los jobs periódicos, que iteran todas). */
export async function listActiveClinics(): Promise<ClinicRow[]> {
  return directus.request(
    readItems("clinics", { filter: { activo: { _eq: true } }, limit: -1 }),
  );
}

/** Clínica por id, solo si está activa (para validar el `?clinica=<id>` del link de agendamiento público). */
export async function getClinicById(id: string): Promise<ClinicRow | undefined> {
  const rows = await directus.request(
    readItems("clinics", { filter: { id: { _eq: id }, activo: { _eq: true } }, limit: 1 }),
  );
  return rows[0];
}

/**
 * Resuelve la clínica dueña de un número de WhatsApp (el `to` del mensaje
 * entrante de YCloud). `undefined` si ninguna clínica tiene ese número
 * configurado — quien llama debe caer a `getDefaultClinic()`.
 */
export async function getClinicByWhatsappNumber(numero: string): Promise<ClinicRow | undefined> {
  const rows = await directus.request(
    readItems("clinics", {
      filter: { activo: { _eq: true }, whatsapp_numero: { _eq: numero } },
      limit: 1,
    }),
  );
  return rows[0];
}

/**
 * Clínica de respaldo cuando el número entrante no coincide con ninguna
 * `whatsapp_numero` configurada (típicamente porque solo existe una clínica
 * y todavía no se le asignó número — despliegue actual de una sola clínica).
 * Si hay más de una clínica activa sin match, no hay forma segura de
 * adivinar cuál es, así que devuelve `undefined`.
 */
export async function getDefaultClinic(): Promise<ClinicRow | undefined> {
  const rows = await directus.request(
    readItems("clinics", { filter: { activo: { _eq: true } }, limit: 2 }),
  );
  return rows.length === 1 ? rows[0] : undefined;
}
