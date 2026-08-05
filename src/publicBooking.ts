import { timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { DateTime } from "luxon";
import { config } from "./config.js";
import type { ClinicRow } from "./directus.js";
import { getClinicById } from "./repositories/clinics.js";
import { listActiveDoctors } from "./repositories/doctors.js";
import { listActiveServices } from "./repositories/services.js";
import { listActiveSpecialties } from "./repositories/specialties.js";
import { getAvailableSlots } from "./repositories/availability.js";
import { bookAppointment, SlotUnavailableError } from "./repositories/appointments.js";
import {
  findOrCreatePatient,
  findTitularByPhone,
  resolveOrCreateHouseholdPatient,
  updatePatientName,
} from "./repositories/patients.js";

declare module "express-serve-static-core" {
  interface Request {
    clinic?: ClinicRow;
  }
}

/** Formato laxo tipo E.164: opcional "+" seguido de 7 a 15 dígitos. */
const PHONE_RE = /^\+?\d{7,15}$/;

/** El formulario público ofrece horas cada 30' (más cómodo para elegir a mano), aunque el paso "real" del bot (SLOT_STEP_MINUTES) sea cada 15'. */
const PUBLIC_BOOKING_STEP_MINUTES = 30;

/**
 * CORS acotado a los orígenes conocidos del panel (mismo criterio que
 * CORS_ORIGIN en la config de Directus, ver CLAUDE.md): refleja el Origin
 * solo si está en la lista, nunca "*" — esta API puede crear pacientes/citas.
 */
function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const allowed = config.PUBLIC_BOOKING_CORS_ORIGINS.split(",").map((o) => o.trim());
  const origin = req.header("Origin");
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Valida el token estático compartido del link (un solo valor, sin expiración
 * ni atado a un teléfono — ver CLAUDE.md/config.ts BOOKING_PUBLIC_LINK_TOKEN),
 * tanto en query (GET) como en body (POST). Si el token no está configurado,
 * la API entera queda deshabilitada (503) en vez de aceptar cualquier cosa.
 */
function verifyTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expected = config.BOOKING_PUBLIC_LINK_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "Agendamiento por link no disponible." });
    return;
  }

  const source = req.method === "GET" ? req.query : req.body;
  const token = typeof source.token === "string" ? source.token : undefined;

  if (!token || !safeEqual(token, expected)) {
    res.status(401).json({ error: "Este enlace no es válido." });
    return;
  }

  next();
}

/**
 * Resuelve la clínica del link (`?clinica=<id>` en GET, `clinica` en el body
 * de POST) — el link que cada clínica comparte incluye su propio id, ej.
 * `https://panel.egonia.site/agendar?clinica=<id>`. 400 si falta o no
 * corresponde a una clínica activa.
 */
function resolveClinicMiddleware(req: Request, res: Response, next: NextFunction): void {
  const source = req.method === "GET" ? req.query : req.body;
  const clinicaId = typeof source.clinica === "string" ? source.clinica : undefined;
  if (!clinicaId) {
    res.status(400).json({ error: "Falta el parámetro clinica." });
    return;
  }
  getClinicById(clinicaId)
    .then((clinic) => {
      if (!clinic) {
        res.status(400).json({ error: "Clínica no encontrada." });
        return;
      }
      req.clinic = clinic;
      next();
    })
    .catch(next);
}

/** Envuelve un handler async para que sus rechazos lleguen a Express sin `try/catch` repetido en cada ruta. */
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const readRateLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
const writeRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

export const publicBookingRouter = Router();

publicBookingRouter.use(corsMiddleware);
publicBookingRouter.use(verifyTokenMiddleware);
publicBookingRouter.use(resolveClinicMiddleware);

/** Datos iniciales para armar el formulario: especialidades, médicos y servicios activos (médicos/servicios traen su specialtyId para filtrar en el cliente). */
publicBookingRouter.get(
  "/context",
  readRateLimit,
  asyncHandler(async (req, res) => {
    const clinic = req.clinic!;
    const [specialties, doctors, services] = await Promise.all([
      listActiveSpecialties(clinic.id),
      listActiveDoctors(clinic.id),
      listActiveServices(clinic.id),
    ]);

    res.json({
      clinicName: clinic.nombre,
      specialties: specialties.map((s) => ({ id: s.id, nombre: s.nombre })),
      doctors: doctors.map((d) => ({ id: d.id, nombre: d.nombre, specialtyId: d.specialtyId })),
      services: services.map((s) => ({ id: s.id, nombre: s.nombre, duracionMin: s.duracionMin, specialtyId: s.specialtyId })),
    });
  }),
);

/** Huecos disponibles de un odontólogo para un servicio, en un rango de fechas (para pintar el calendario y, al elegir día, las horas). */
publicBookingRouter.get(
  "/availability",
  readRateLimit,
  asyncHandler(async (req, res) => {
    const clinic = req.clinic!;
    const { doctorId, serviceId, from, to } = req.query;
    if (
      typeof doctorId !== "string" ||
      typeof serviceId !== "string" ||
      typeof from !== "string" ||
      typeof to !== "string"
    ) {
      res.status(400).json({ error: "Faltan parámetros." });
      return;
    }

    const timezone = clinic.zona_horaria || config.CLINIC_TIMEZONE;
    const fromDt = DateTime.fromFormat(from, "yyyy-LL-dd", { zone: timezone });
    const toDt = DateTime.fromFormat(to, "yyyy-LL-dd", { zone: timezone });
    if (!fromDt.isValid || !toDt.isValid) {
      res.status(400).json({ error: "Fechas inválidas." });
      return;
    }

    const slots = await getAvailableSlots({
      clinicId: clinic.id,
      serviceId,
      doctorId,
      from: fromDt,
      to: toDt,
      stepMinutes: PUBLIC_BOOKING_STEP_MINUTES,
    });
    res.json({ slots: slots.map((s) => s.inicio.toISOString()) });
  }),
);

/**
 * Nombre del titular ya registrado bajo un teléfono, para que el formulario no
 * vuelva a pedirlo si ya se conoce (y para no confundir "cita para el titular"
 * con "cita para otra persona" una vez que se sabe quién es el titular).
 * No crea nada: `nombre: null` cubre tanto "el número no existe todavía" como
 * "el titular existe pero aún no tiene nombre" — en ambos casos el formulario
 * debe seguir pidiéndolo.
 */
publicBookingRouter.get(
  "/titular",
  readRateLimit,
  asyncHandler(async (req, res) => {
    const { telefono } = req.query;
    if (typeof telefono !== "string" || !PHONE_RE.test(telefono.trim())) {
      res.status(400).json({ error: "Número de teléfono inválido." });
      return;
    }
    const titular = await findTitularByPhone(telefono.trim(), req.clinic!.id);
    res.json({ nombre: titular?.nombre?.trim() || null });
  }),
);

/**
 * Crea la cita: el teléfono lo escribe la propia persona (el link ya no está
 * atado a un número verificado), así que se valida el formato acá antes de
 * usarlo como identidad del paciente. Busca/crea al paciente por teléfono,
 * actualiza el nombre si se dio uno nuevo, y agenda con las mismas reglas que
 * el resto del sistema.
 */
publicBookingRouter.post(
  "/appointments",
  writeRateLimit,
  asyncHandler(async (req, res) => {
    const clinic = req.clinic!;
    const { telefono, nombre, pacienteNombre, doctorId, serviceId, inicio } = req.body as Record<string, unknown>;

    if (
      typeof telefono !== "string" ||
      typeof doctorId !== "string" ||
      typeof serviceId !== "string" ||
      typeof inicio !== "string" ||
      (nombre !== undefined && typeof nombre !== "string") ||
      (pacienteNombre !== undefined && typeof pacienteNombre !== "string")
    ) {
      res.status(400).json({ error: "Datos incompletos." });
      return;
    }

    const telefonoTrim = telefono.trim();
    if (!PHONE_RE.test(telefonoTrim)) {
      res.status(400).json({ error: "Ingresa un número de teléfono válido." });
      return;
    }

    const inicioDate = new Date(inicio);
    if (Number.isNaN(inicioDate.getTime())) {
      res.status(400).json({ error: "Fecha/hora inválida." });
      return;
    }

    try {
      const titular = await findOrCreatePatient(telefonoTrim, clinic.id);
      const nombreTrim = nombre?.trim();
      // Solo completa el nombre del titular si aún no tiene uno: un teléfono puede
      // tener varios pacientes (ej. un hijo bajo el número de la madre), así que
      // nunca se debe sobrescribir el nombre ya guardado del titular.
      if (nombreTrim && !titular.nombre) {
        await updatePatientName(titular.id, nombreTrim);
      }

      // pacienteNombre: la cita es para otra persona (ej. un hijo) bajo el mismo
      // teléfono, no para quien llena el formulario. Se resuelve/crea sin pisar
      // al titular, igual que el bot de WhatsApp lo hace en una conversación.
      const pacienteNombreTrim = pacienteNombre?.trim();
      let patientId = titular.id;
      if (pacienteNombreTrim) {
        const { patient, ambiguous } = await resolveOrCreateHouseholdPatient(telefonoTrim, pacienteNombreTrim, clinic.id);
        if (ambiguous) {
          res.status(400).json({
            error: `Hay más de una persona registrada como "${pacienteNombreTrim}" en este número. Llama a la clínica para agendarle.`,
          });
          return;
        }
        patientId = patient.id;
      }

      const appointment = await bookAppointment({
        clinicId: clinic.id,
        doctorId,
        patientId,
        serviceId,
        inicio: inicioDate,
        origen: "link_publico",
      });

      res.status(201).json({
        id: appointment.id,
        inicio: appointment.inicio.toISOString(),
        fin: appointment.fin.toISOString(),
      });
    } catch (error) {
      if (error instanceof SlotUnavailableError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  }),
);
