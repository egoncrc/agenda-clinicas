import { createItem, readItems, updateItem } from "@directus/sdk";
import { directus, type PatientRow } from "../directus.js";

/**
 * Excluye a los pacientes dados de baja desde el panel. Se usa `_neq: false` y
 * no `_eq: true` porque una fila creada fuera del panel puede tener `activo` en
 * NULL sin estar dada de baja. Efecto buscado: si recepción da de baja a un
 * paciente y esa persona vuelve a escribir por WhatsApp, el bot crea una ficha
 * nueva en vez de resucitar la vieja.
 */
const ACTIVO = { _neq: false };

/** Busca al *titular* de un número dentro de una clínica sin crearlo si no existe (a diferencia de `findOrCreatePatient`). */
export async function findTitularByPhone(telefono: string, clinicId: string): Promise<PatientRow | null> {
  const existing = await directus.request(
    readItems("patients", {
      filter: { telefono: { _eq: telefono }, titular: { _eq: true }, clinic: { _eq: clinicId }, activo: ACTIVO },
      limit: 1,
    }),
  );
  return (existing[0] as PatientRow | undefined) ?? null;
}

/**
 * Resuelve al *titular* de un número (E.164) dentro de una clínica: el dueño
 * del teléfono con quien conversa el bot de WhatsApp de esa clínica. Un mismo
 * teléfono puede ser titular en varias clínicas (cada una con su propio
 * número de WhatsApp, conversaciones independientes) — se crea si esa
 * clínica aún no tiene titular para ese número.
 */
export async function findOrCreatePatient(telefono: string, clinicId: string): Promise<PatientRow> {
  const existing = await findTitularByPhone(telefono, clinicId);
  if (existing) return existing;
  return (await directus.request(
    createItem("patients", { telefono, titular: true, clinic: clinicId }),
  )) as PatientRow;
}

/** Todos los pacientes de una clínica ligados a un número (titular + familiares): el "grupo" del teléfono. */
export async function listPatientsByPhone(telefono: string, clinicId: string): Promise<PatientRow[]> {
  return (await directus.request(
    readItems("patients", {
      filter: { telefono: { _eq: telefono }, clinic: { _eq: clinicId }, activo: ACTIVO },
      limit: -1,
    }),
  )) as PatientRow[];
}

/** Crea un paciente familiar (no titular) bajo el número de otra persona, en una clínica. */
export async function createDependentPatient(telefono: string, nombre: string, clinicId: string): Promise<PatientRow> {
  return (await directus.request(
    createItem("patients", { telefono, nombre, titular: false, clinic: clinicId }),
  )) as PatientRow;
}

export interface HouseholdResolution {
  patient: PatientRow;
  /** Hay más de una persona con ese nombre bajo el mismo número: hay que aclarar cuál, no adivinar. */
  ambiguous: boolean;
}

/**
 * Resuelve, entre los pacientes de un teléfono en una clínica, a la persona
 * con ese nombre (sin distinguir mayúsculas); si no existe, la crea como
 * familiar (no titular). Usado tanto por el bot (agendar para "mi hijo Juan")
 * como por el formulario público de reserva, para no crear un paciente
 * duplicado cada vez que alguien ya conocido bajo ese número vuelve a agendar.
 */
export async function resolveOrCreateHouseholdPatient(
  telefono: string,
  nombre: string,
  clinicId: string,
): Promise<HouseholdResolution> {
  const group = await listPatientsByPhone(telefono, clinicId);
  const norm = nombre.trim().toLowerCase();
  const matches = group.filter((p) => p.nombre?.trim().toLowerCase() === norm);
  const [firstMatch] = matches;
  if (firstMatch) {
    return { patient: firstMatch, ambiguous: matches.length > 1 };
  }
  const created = await createDependentPatient(telefono, nombre.trim(), clinicId);
  return { patient: created, ambiguous: false };
}

/** Solo resuelve si el paciente pertenece a `clinicId` — evita que un id de otra clínica se filtre. */
export async function getPatient(id: string, clinicId: string): Promise<PatientRow> {
  const rows = (await directus.request(
    readItems("patients", { filter: { id: { _eq: id }, clinic: { _eq: clinicId } }, limit: 1 }),
  )) as PatientRow[];
  const row = rows[0];
  if (!row) throw new Error(`Paciente no encontrado: ${id}`);
  return row;
}

export async function updatePatientName(id: string, nombre: string): Promise<void> {
  await directus.request(updateItem("patients", id, { nombre }));
}
