import { defineHook } from "@directus/extensions-sdk";
import { ForbiddenError } from "@directus/errors";

/** Estados que ocupan la agenda; cancelada/no_show liberan el hueco. */
const BLOCKING_STATUSES = ["pendiente", "confirmada", "completada"];

interface AppointmentPayload {
  doctor?: string;
  patient?: string;
  service?: string;
  inicio?: string;
  fin?: string;
  estado?: string;
  clinic?: string;
}

export default defineHook(({ filter }, { services, database }) => {
  const { ItemsService } = services;

  /**
   * Verifica que la cita (nueva o editada) no se solape con otra cita activa
   * del mismo odontólogo, aplicando el buffer configurado en el servicio, ni
   * con una ausencia (time_off) declarada del odontólogo en esa clínica. Lanza
   * ForbiddenException (HTTP 403) si hay conflicto, abortando la escritura —
   * se aplica sin importar si la cita se crea desde el bot, el panel de
   * Directus o cualquier otro cliente de la API.
   *
   * Un médico puede trabajar en varias clínicas (M2M `clinics_doctors`) pero no
   * puede estar en dos a la vez, así que el solape entre citas se evalúa
   * CROSS-CLÍNICA. Las ausencias, en cambio, son por clínica: bloquean solo la
   * agenda de la sede donde se registraron.
   */
  async function assertNoOverlap(
    payload: AppointmentPayload,
    existingId: string | null,
    schema: unknown,
    accountability: unknown,
  ): Promise<void> {
    // `accountability: null` = acceso de sistema, a propósito y solo para este
    // servicio (mismo criterio que time-off-cascade-hook). Con el accountability
    // del usuario, una recepcionista de la clínica A no puede leer la cita que
    // el médico tiene en la clínica B: la consulta de solapes volvería vacía y
    // la doble reserva entre clínicas pasaría sin que nada la detenga.
    const appointmentsService = new ItemsService("appointments", {
      schema,
      accountability: null,
      knex: database,
    });
    const servicesService = new ItemsService("services", {
      schema,
      accountability,
      knex: database,
    });
    const timeOffService = new ItemsService("time_off", {
      schema,
      accountability,
      knex: database,
    });

    let { doctor, patient, service, inicio, fin, estado, clinic } = payload;

    // En un update el payload puede venir parcial: se completa con el
    // registro actual para poder evaluar el solape correctamente.
    if (existingId && (!doctor || !patient || !service || !inicio || !fin || !estado || !clinic)) {
      const current = (await appointmentsService.readOne(existingId, {
        fields: ["doctor", "patient", "service", "inicio", "fin", "estado", "clinic"],
      })) as AppointmentPayload;
      doctor = doctor ?? current.doctor;
      patient = patient ?? current.patient;
      service = service ?? current.service;
      inicio = inicio ?? current.inicio;
      fin = fin ?? current.fin;
      estado = estado ?? current.estado;
      clinic = clinic ?? current.clinic;
    }

    estado = estado ?? "pendiente";
    if (!BLOCKING_STATUSES.includes(estado)) return;
    if (!doctor || !service || !inicio || !fin) return;

    const svc = (await servicesService.readOne(service, {
      fields: ["buffer_min"],
    })) as { buffer_min?: number } | null;
    const bufferMin = svc?.buffer_min ?? 0;
    const bufferMs = bufferMin * 60_000;

    const rangeStart = new Date(new Date(inicio).getTime() - bufferMs).toISOString();
    const rangeEnd = new Date(new Date(fin).getTime() + bufferMs).toISOString();

    const filterConditions: Record<string, unknown> = {
      _and: [
        { doctor: { _eq: doctor } },
        { estado: { _in: BLOCKING_STATUSES } },
        { inicio: { _lt: rangeEnd } },
        { fin: { _gt: rangeStart } },
        ...(existingId ? [{ id: { _neq: existingId } }] : []),
      ],
    };

    const clashes = await appointmentsService.readByQuery({
      filter: filterConditions,
      limit: 1,
      fields: ["id"],
    });

    if (clashes.length > 0) {
      // El mensaje no dice en qué clínica está la cita que estorba: quien
      // agenda puede ser de otra sede y no debe ver datos de un tenant ajeno.
      throw new ForbiddenError({
        reason:
          "La cita se solapa con otra existente para este odontólogo (incluyendo el tiempo de preparación entre citas).",
      });
    }

    // Un paciente no puede estar en dos consultas a la vez EN LA MISMA
    // CLÍNICA, sin importar el odontólogo o la especialidad — a diferencia
    // del chequeo anterior, este sí se acota a `clinic` y no aplica ningún
    // buffer (el buffer es tiempo de preparación del médico, no del paciente).
    if (patient) {
      const patientClashes = await appointmentsService.readByQuery({
        filter: {
          _and: [
            { patient: { _eq: patient } },
            { clinic: { _eq: clinic } },
            { estado: { _in: BLOCKING_STATUSES } },
            { inicio: { _lt: fin } },
            { fin: { _gt: inicio } },
            ...(existingId ? [{ id: { _neq: existingId } }] : []),
          ],
        },
        limit: 1,
        fields: ["id"],
      });

      if (patientClashes.length > 0) {
        throw new ForbiddenError({
          reason: "Este paciente ya tiene otra cita que se traslapa con este horario en esta clínica.",
        });
      }
    }

    // Las ausencias sí se acotan a la clínica de la cita: un médico ausente en
    // una sede puede seguir atendiendo en la otra.
    const timeOffClashes = await timeOffService.readByQuery({
      filter: {
        _and: [
          { doctor: { _eq: doctor } },
          ...(clinic ? [{ clinic: { _eq: clinic } }] : []),
          { inicio: { _lt: fin } },
          { fin: { _gt: inicio } },
        ],
      },
      limit: 1,
      fields: ["id"],
    });

    if (timeOffClashes.length > 0) {
      throw new ForbiddenError({
        reason: "La cita se solapa con una ausencia (time off) declarada para este odontólogo.",
      });
    }
  }

  filter<AppointmentPayload>(
    "appointments.items.create",
    async (payload, _meta, context) => {
      await assertNoOverlap(payload, null, context.schema, context.accountability);
      return payload;
    },
  );

  filter<AppointmentPayload>(
    "appointments.items.update",
    async (payload, meta, context) => {
      const keys = Array.isArray(meta.keys) ? meta.keys : [meta.keys];
      for (const key of keys) {
        await assertNoOverlap(payload, String(key), context.schema, context.accountability);
      }
      return payload;
    },
  );
});
