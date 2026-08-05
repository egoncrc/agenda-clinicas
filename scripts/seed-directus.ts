/**
 * Siembra (carga) los datos iniciales de la clínica en Directus: odontólogos,
 * catálogo de servicios y horarios laborales.
 *
 * EDITA la sección CONFIG de abajo con los datos reales de tu clínica antes
 * de ejecutar. Todo lo que está debajo de "Implementación" no hace falta
 * tocarlo.
 *
 * Uso:
 *   DIRECTUS_ADMIN_TOKEN=<token_admin> npm run seed
 *
 * Idempotencia:
 *   - Odontólogos y servicios se emparejan por `nombre`: si ya existen se
 *     actualizan (no se duplican).
 *   - Los horarios laborales de un odontólogo se REEMPLAZAN por completo con
 *     lo que definas en WORKING_HOURS cada vez que corres el script (pensado
 *     para la carga inicial; si el horario ya se ajusta manualmente desde el
 *     panel, no vuelvas a correr este script sin actualizar antes el config).
 *   - NO toca pacientes, citas ni ausencias (time_off): esos se gestionan en
 *     el día a día, no en el seed.
 */
import "dotenv/config";
import {
  createDirectus,
  rest,
  staticToken,
  createItem,
  createItems,
  readItems,
  updateItem,
  deleteItems,
} from "@directus/sdk";
import type { Schema, DoctorRow, ServiceRow, SpecialtyRow } from "../src/directus.js";
import type { IsoWeekday } from "../src/domain/types.js";

// ============================================================================
// CONFIG — EDITA esto con los datos reales de la clínica
// ============================================================================

/**
 * Especialidades de la clínica. `key` es un identificador interno para
 * referenciarlas desde DOCTORS/SERVICES; no se guarda en Directus.
 */
const SPECIALTIES = [
  { key: "odon", nombre: "Odontología", activo: true },
] as const;

type SpecialtyKey = (typeof SPECIALTIES)[number]["key"];

/**
 * Médicos de la clínica.
 * `key` es solo un identificador interno para referenciarlos en WORKING_HOURS
 * de abajo; no se guarda en Directus. `specialtyKey` los liga a una especialidad.
 */
const DOCTORS = [
  { key: "dr1", nombre: "Dr. Rodolfo Sánchez", activo: true, specialtyKey: "odon" as SpecialtyKey },
  { key: "dr2", nombre: "Dra. Yendry Delgado", activo: true, specialtyKey: "odon" as SpecialtyKey },
] as const;

type DoctorKey = (typeof DOCTORS)[number]["key"];

/**
 * Catálogo de servicios con la duración REAL de la cita (minutos), un
 * buffer opcional de limpieza/preparación entre citas, y su especialidad.
 * Ajusta nombres, duraciones y buffers a los de tu clínica.
 */
const SERVICES = [
  { nombre: "Consulta / valoración", duracion_min: 20, buffer_min: 5, activo: true, specialtyKey: "odon" as SpecialtyKey },
  { nombre: "Limpieza dental (profilaxis)", duracion_min: 30, buffer_min: 10, activo: true, specialtyKey: "odon" as SpecialtyKey },
  { nombre: "Resina / obturación", duracion_min: 45, buffer_min: 10, activo: true, specialtyKey: "odon" as SpecialtyKey },
  { nombre: "Tratamiento de conducto (endodoncia)", duracion_min: 60, buffer_min: 15, activo: true, specialtyKey: "odon" as SpecialtyKey },
  { nombre: "Extracción simple", duracion_min: 30, buffer_min: 10, activo: true, specialtyKey: "odon" as SpecialtyKey },
  { nombre: "Extracción quirúrgica", duracion_min: 60, buffer_min: 15, activo: true, specialtyKey: "odon" as SpecialtyKey },
  { nombre: "Blanqueamiento dental", duracion_min: 60, buffer_min: 10, activo: true, specialtyKey: "odon" as SpecialtyKey },
  { nombre: "Colocación de corona", duracion_min: 60, buffer_min: 15, activo: true, specialtyKey: "odon" as SpecialtyKey },
  { nombre: "Control / revisión de ortodoncia", duracion_min: 20, buffer_min: 5, activo: true, specialtyKey: "odon" as SpecialtyKey },
] as const;

interface WorkingHourEntry {
  doctorKey: DoctorKey;
  dia_semana: IsoWeekday;
  hora_inicio: string; // "HH:mm:ss"
  hora_fin: string;
}

/** Atajo para generar el mismo bloque de horario en varios días de la semana. */
function bloque(
  doctorKey: DoctorKey,
  dias: IsoWeekday[],
  hora_inicio: string,
  hora_fin: string,
): WorkingHourEntry[] {
  return dias.map((dia_semana) => ({ doctorKey, dia_semana, hora_inicio, hora_fin }));
}

const LUNES_A_VIERNES: IsoWeekday[] = [1, 2, 3, 4, 5];

/**
 * Horario laboral por odontólogo. dia_semana: 1=Lunes ... 7=Domingo.
 * Ejemplo de referencia: ajusta días/horas reales de cada uno.
 */
const WORKING_HOURS: WorkingHourEntry[] = [
  // Dr. Juan Pérez: Lunes a Viernes 08:00-13:00 y 14:00-18:00
  ...bloque("dr1", LUNES_A_VIERNES, "08:00:00", "13:00:00"),
  ...bloque("dr1", LUNES_A_VIERNES, "14:00:00", "18:00:00"),

  // Dra. María Gómez: Lunes a Viernes 09:00-13:00 y 15:00-19:00, Sábado 09:00-12:00
  ...bloque("dr2", LUNES_A_VIERNES, "09:00:00", "13:00:00"),
  ...bloque("dr2", LUNES_A_VIERNES, "15:00:00", "19:00:00"),
  ...bloque("dr2", [6], "09:00:00", "12:00:00"),
];

// ============================================================================
// Implementación (no hace falta editar debajo de esta línea)
// ============================================================================

const url = process.env.DIRECTUS_URL;
const adminToken = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !adminToken) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN) en el entorno.");
  process.exit(1);
}

const client = createDirectus<Schema>(url).with(staticToken(adminToken)).with(rest());

/** Clínica destino del seed (multi-clínica): la primera activa. Todo se acota a ella. */
async function resolveClinicId(): Promise<string> {
  const rows = (await client.request(
    readItems("clinics", { filter: { activo: { _eq: true } }, limit: 1, fields: ["id", "nombre"] }),
  )) as { id: string; nombre: string }[];
  if (!rows[0]) throw new Error("No hay ninguna clínica activa. Corre provision-clinics.ts primero.");
  console.log(`Clínica destino: "${rows[0].nombre}" (${rows[0].id})\n`);
  return rows[0].id;
}

async function upsertSpecialty(
  clinicId: string,
  s: { nombre: string; activo: boolean },
): Promise<string> {
  const existing = await client.request(
    readItems("specialties", { filter: { nombre: { _eq: s.nombre }, clinic: { _eq: clinicId } }, limit: 1 }),
  );
  if (existing.length > 0) {
    const row = existing[0] as SpecialtyRow;
    await client.request(updateItem("specialties", row.id, { activo: s.activo }));
    console.log(`  · especialidad "${s.nombre}" ya existía (actualizada)`);
    return row.id;
  }
  const created = (await client.request(
    createItem("specialties", { ...s, clinic: clinicId } as never),
  )) as SpecialtyRow;
  console.log(`  ✓ especialidad "${s.nombre}" creada`);
  return created.id;
}

/**
 * Un médico es una fila `doctors` (la persona) más una fila `clinics_doctors`
 * por clínica donde trabaja, que es donde vive su especialidad en esa sede.
 * Idempotente en las dos: si el nombre ya existe se reutiliza la identidad y
 * solo se asegura el vínculo.
 */
async function upsertDoctor(
  clinicId: string,
  d: { nombre: string; activo: boolean; specialty: string },
): Promise<string> {
  const existing = await client.request(
    readItems("doctors", { filter: { nombre: { _eq: d.nombre } }, limit: 1 }),
  );
  let doctorId: string;
  if (existing.length > 0) {
    const row = existing[0] as DoctorRow;
    doctorId = row.id;
    await client.request(updateItem("doctors", row.id, { activo: d.activo }));
    console.log(`  · médico/a "${d.nombre}" ya existía (actualizado)`);
  } else {
    const created = (await client.request(
      createItem("doctors", { nombre: d.nombre, activo: d.activo } as never),
    )) as DoctorRow;
    doctorId = created.id;
    console.log(`  ✓ médico/a "${d.nombre}" creado`);
  }

  const links = await client.request(
    readItems("clinics_doctors", {
      filter: { clinics_id: { _eq: clinicId }, doctors_id: { _eq: doctorId } },
      limit: 1,
    }),
  );
  if (links[0]) {
    await client.request(
      updateItem("clinics_doctors", links[0].id, { specialty: d.specialty, activo: d.activo }),
    );
  } else {
    await client.request(
      createItem("clinics_doctors", {
        clinics_id: clinicId,
        doctors_id: doctorId,
        specialty: d.specialty,
        activo: d.activo,
      } as never),
    );
    console.log(`    ✓ vinculado/a a la clínica`);
  }
  return doctorId;
}

async function upsertService(
  clinicId: string,
  s: {
    nombre: string;
    duracion_min: number;
    buffer_min: number;
    activo: boolean;
    specialty: string;
  },
): Promise<string> {
  const existing = await client.request(
    readItems("services", { filter: { nombre: { _eq: s.nombre }, clinic: { _eq: clinicId } }, limit: 1 }),
  );
  if (existing.length > 0) {
    const row = existing[0] as ServiceRow;
    await client.request(
      updateItem("services", row.id, {
        duracion_min: s.duracion_min,
        buffer_min: s.buffer_min,
        activo: s.activo,
        specialty: s.specialty,
      }),
    );
    console.log(`  · servicio "${s.nombre}" ya existía (actualizado: ${s.duracion_min}min)`);
    return row.id;
  }
  const created = (await client.request(
    createItem("services", { ...s, clinic: clinicId } as never),
  )) as ServiceRow;
  console.log(`  ✓ servicio "${s.nombre}" creado (${s.duracion_min}min)`);
  return created.id;
}

/** Reemplaza el horario del médico EN esta clínica; el que tenga en otras sedes no se toca. */
async function replaceWorkingHours(
  clinicId: string,
  doctorId: string,
  doctorLabel: string,
  entries: WorkingHourEntry[],
): Promise<void> {
  const existing = await client.request(
    readItems("working_hours", {
      filter: { doctor: { _eq: doctorId }, clinic: { _eq: clinicId } },
      limit: -1,
    }),
  );
  if (existing.length > 0) {
    await client.request(
      deleteItems(
        "working_hours",
        existing.map((e) => e.id),
      ),
    );
  }
  if (entries.length === 0) return;
  await client.request(
    createItems(
      "working_hours",
      entries.map((e) => ({
        doctor: doctorId,
        clinic: clinicId,
        dia_semana: e.dia_semana,
        hora_inicio: e.hora_inicio,
        hora_fin: e.hora_fin,
      })),
    ),
  );
  console.log(`  ✓ ${entries.length} bloques de horario cargados para ${doctorLabel}`);
}

async function main() {
  console.log(`Sembrando datos en ${url} ...\n`);

  const clinicId = await resolveClinicId();

  console.log("Especialidades:");
  const specialtyIds = new Map<SpecialtyKey, string>();
  for (const sp of SPECIALTIES) {
    const id = await upsertSpecialty(clinicId, { nombre: sp.nombre, activo: sp.activo });
    specialtyIds.set(sp.key, id);
  }

  console.log("\nMédicos:");
  const doctorIds = new Map<DoctorKey, string>();
  for (const d of DOCTORS) {
    const id = await upsertDoctor(clinicId, {
      nombre: d.nombre,
      activo: d.activo,
      specialty: specialtyIds.get(d.specialtyKey)!,
    });
    doctorIds.set(d.key, id);
  }

  console.log("\nServicios:");
  for (const s of SERVICES) {
    await upsertService(clinicId, {
      nombre: s.nombre,
      duracion_min: s.duracion_min,
      buffer_min: s.buffer_min,
      activo: s.activo,
      specialty: specialtyIds.get(s.specialtyKey)!,
    });
  }

  console.log("\nHorarios laborales:");
  for (const d of DOCTORS) {
    const doctorId = doctorIds.get(d.key)!;
    const entries = WORKING_HOURS.filter((e) => e.doctorKey === d.key);
    await replaceWorkingHours(clinicId, doctorId, d.nombre, entries);
  }

  console.log("\nListo. Revisa doctors / services / working_hours en el panel de Directus.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
