import { createItem, readItems } from "@directus/sdk";
import { directus, type MessageRow } from "../directus.js";

/** Guarda un mensaje (entrante o saliente) en el historial de la conversación. */
export async function logMessage(
  patientId: string,
  direccion: "in" | "out",
  contenido: string,
  waMessageId?: string,
): Promise<void> {
  await directus.request(
    createItem("messages", {
      patient: patientId,
      direccion,
      contenido,
      wa_message_id: waMessageId ?? null,
    }),
  );
}

/** Últimos N mensajes del paciente, en orden cronológico (más antiguo primero), para dar contexto al agente de IA. */
export async function getRecentMessages(patientId: string, limit: number): Promise<MessageRow[]> {
  const rows = await directus.request(
    readItems("messages", {
      filter: { patient: { _eq: patientId } },
      sort: ["-date_created"],
      limit,
    }),
  );
  return (rows as MessageRow[]).reverse();
}
