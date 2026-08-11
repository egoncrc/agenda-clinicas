import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceRow, AppointmentRow } from "../directus.js";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("../directus.js", () => ({ directus: { request: requestMock } }));

const {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  AppointmentNotFoundError,
  PatientScheduleConflictError,
  SlotUnavailableError,
} = await import("./appointments.js");

const CLINIC_ID = "clinic-1";

const SERVICE: ServiceRow = {
  id: "svc-1",
  nombre: "Limpieza dental",
  duracion_min: 30,
  buffer_min: 10,
  activo: true,
  clinic: CLINIC_ID,
  specialty: "sp-odon",
};

function appointmentRow(overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: "appt-existing",
    clinic: CLINIC_ID,
    doctor: "doctor-1",
    patient: "patient-other",
    service: "svc-1",
    inicio: "2026-07-13T08:00:00.000-05:00",
    fin: "2026-07-13T08:30:00.000-05:00",
    estado: "pendiente",
    origen: "whatsapp",
    recordatorio_24h_enviado: false,
    recordatorio_2h_enviado: false,
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

/**
 * `bookAppointment` arranca comprobando que el médico trabaje en la clínica
 * (getDoctor), y eso son dos consultas: el vínculo en `clinics_doctors` y la
 * identidad en `doctors`. Como los mocks van por orden de llamada, tienen que
 * ir siempre primero.
 */
function mockGetDoctor(): void {
  requestMock
    .mockResolvedValueOnce([
      { id: "cd-1", clinics_id: CLINIC_ID, doctors_id: "doctor-1", specialty: "sp-odon", activo: true },
    ])
    .mockResolvedValueOnce([{ id: "doctor-1", nombre: "Dra. Uno", activo: true }]);
}

describe("bookAppointment", () => {
  it("crea la cita cuando no hay solape", async () => {
    mockGetDoctor();
    requestMock
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor: agenda vacía
      .mockResolvedValueOnce([]) // blockingAppointmentsForPatientInClinic: sin otras citas del paciente
      .mockResolvedValueOnce([]) // timeOffForDoctor: sin ausencias
      .mockResolvedValueOnce(appointmentRow({ id: "appt-new", patient: "patient-1" })); // createItem

    const result = await bookAppointment({
      clinicId: CLINIC_ID,
      doctorId: "doctor-1",
      patientId: "patient-1",
      serviceId: "svc-1",
      inicio: new Date("2026-07-13T13:00:00.000Z"), // 08:00 America/Guayaquil
    });

    expect(result.id).toBe("appt-new");
    expect(requestMock).toHaveBeenCalledTimes(7);
  });

  it("rechaza sin llegar a Directus si ya hay una cita solapada (chequeo Node)", async () => {
    mockGetDoctor();
    requestMock
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([appointmentRow()]); // blockingAppointmentsForDoctor: ya hay una cita 08:00-08:30

    await expect(
      bookAppointment({
        clinicId: CLINIC_ID,
        doctorId: "doctor-1",
        patientId: "patient-1",
        serviceId: "svc-1",
        inicio: new Date("2026-07-13T13:15:00.000Z"), // 08:15, se solapa con la de 08:00-08:30
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    // No debe haber intentado crear la cita.
    expect(requestMock).toHaveBeenCalledTimes(4);
  });

  it("rechaza si el mismo paciente ya tiene otra cita que se traslapa en la misma clínica, con OTRO médico", async () => {
    mockGetDoctor();
    requestMock
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor: este médico tiene la agenda libre
      .mockResolvedValueOnce([
        appointmentRow({ id: "appt-otro-medico", doctor: "doctor-2", patient: "patient-1" }),
      ]); // blockingAppointmentsForPatientInClinic: el paciente ya tiene 08:00-08:30 con otro médico

    await expect(
      bookAppointment({
        clinicId: CLINIC_ID,
        doctorId: "doctor-1",
        patientId: "patient-1",
        serviceId: "svc-1",
        inicio: new Date("2026-07-13T13:15:00.000Z"), // 08:15, se traslapa con la cita del paciente con doctor-2
      }),
    ).rejects.toBeInstanceOf(PatientScheduleConflictError);

    // No debe haber intentado crear la cita.
    expect(requestMock).toHaveBeenCalledTimes(5);
  });

  it("permite la misma franja del paciente si la otra cita está en OTRA clínica", async () => {
    mockGetDoctor();
    requestMock
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor
      .mockResolvedValueOnce([]) // blockingAppointmentsForPatientInClinic: filtrado por clinic, no ve la de otra sede
      .mockResolvedValueOnce([]) // timeOffForDoctor
      .mockResolvedValueOnce(appointmentRow({ id: "appt-new", patient: "patient-1" })); // createItem

    const result = await bookAppointment({
      clinicId: CLINIC_ID,
      doctorId: "doctor-1",
      patientId: "patient-1",
      serviceId: "svc-1",
      inicio: new Date("2026-07-13T13:15:00.000Z"),
    });

    expect(result.id).toBe("appt-new");
  });

  it("rechaza sin llegar a Directus si el horario cae dentro de una ausencia (time off) del odontólogo", async () => {
    mockGetDoctor();
    requestMock
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor: agenda vacía
      .mockResolvedValueOnce([]) // blockingAppointmentsForPatientInClinic: sin otras citas del paciente
      .mockResolvedValueOnce([
        { id: "to-1", doctor: "doctor-1", inicio: "2026-07-13T13:00:00.000Z", fin: "2026-07-13T18:00:00.000Z" },
      ]); // timeOffForDoctor: odontólogo ausente 08:00-13:00 local

    await expect(
      bookAppointment({
        clinicId: CLINIC_ID,
        doctorId: "doctor-1",
        patientId: "patient-1",
        serviceId: "svc-1",
        inicio: new Date("2026-07-13T14:00:00.000Z"), // 09:00 local, dentro de la ausencia
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    // No debe haber intentado crear la cita.
    expect(requestMock).toHaveBeenCalledTimes(6);
  });

  it("condición de carrera real: el chequeo de Node pasa pero el hook de Directus rechaza con 403 FORBIDDEN", async () => {
    const directusForbiddenError = {
      message: "You don't have permission to access this.",
      errors: [
        {
          message: "El horario se solapa con otra cita.",
          extensions: { code: "FORBIDDEN" },
        },
      ],
      response: { status: 403 },
    };

    mockGetDoctor();
    requestMock
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor: Node no ve nada (otro proceso reservó justo antes)
      .mockResolvedValueOnce([]) // blockingAppointmentsForPatientInClinic: sin otras citas del paciente
      .mockResolvedValueOnce([]) // timeOffForDoctor: sin ausencias
      .mockRejectedValueOnce(directusForbiddenError); // createItem: el hook de Directus sí lo atrapa

    await expect(
      bookAppointment({
        clinicId: CLINIC_ID,
        doctorId: "doctor-1",
        patientId: "patient-1",
        serviceId: "svc-1",
        inicio: new Date("2026-07-13T13:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("propaga errores de Directus que no son el rechazo por solape", async () => {
    mockGetDoctor();
    requestMock
      .mockResolvedValueOnce([SERVICE])
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor
      .mockResolvedValueOnce([]) // blockingAppointmentsForPatientInClinic
      .mockResolvedValueOnce([]) // timeOffForDoctor
      .mockRejectedValueOnce(new Error("Directus caído"));

    await expect(
      bookAppointment({
        clinicId: CLINIC_ID,
        doctorId: "doctor-1",
        patientId: "patient-1",
        serviceId: "svc-1",
        inicio: new Date("2026-07-13T13:00:00.000Z"),
      }),
    ).rejects.toThrow("Directus caído");
  });

  it("rechaza si el médico no trabaja en esa clínica", async () => {
    requestMock.mockResolvedValueOnce([]); // getDoctor: sin vínculo con la clínica

    await expect(
      bookAppointment({
        clinicId: CLINIC_ID,
        doctorId: "doctor-de-otra-clinica",
        patientId: "patient-1",
        serviceId: "svc-1",
        inicio: new Date("2026-07-13T13:00:00.000Z"),
      }),
    ).rejects.toThrow(/no encontrado/i);

    // Se corta antes de leer el servicio o la agenda.
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

});

describe("dos pacientes pidiendo el mismo hueco (concurrencia)", () => {
  it("el primero reserva y el segundo, al ver esa cita ya creada, es rechazado", async () => {
    mockGetDoctor();
    requestMock
      .mockResolvedValueOnce([SERVICE])
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor
      .mockResolvedValueOnce([]) // blockingAppointmentsForPatientInClinic
      .mockResolvedValueOnce([]) // timeOffForDoctor
      .mockResolvedValueOnce(appointmentRow({ id: "appt-first", patient: "patient-1" }));

    const first = await bookAppointment({
      clinicId: CLINIC_ID,
      doctorId: "doctor-1",
      patientId: "patient-1",
      serviceId: "svc-1",
      inicio: new Date("2026-07-13T13:00:00.000Z"),
    });
    expect(first.id).toBe("appt-first");

    // El segundo paciente pide el mismo horario; esta vez blockingAppointmentsForDoctor
    // sí devuelve la cita que acaba de crear el primero.
    mockGetDoctor();
    requestMock
      .mockResolvedValueOnce([SERVICE])
      .mockResolvedValueOnce([appointmentRow({ id: "appt-first", patient: "patient-1" })]);

    await expect(
      bookAppointment({
        clinicId: CLINIC_ID,
        doctorId: "doctor-1",
        patientId: "patient-2",
        serviceId: "svc-1",
        inicio: new Date("2026-07-13T13:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });
});

describe("rescheduleAppointment", () => {
  it("mueve la cita cuando el nuevo horario está libre", async () => {
    requestMock
      .mockResolvedValueOnce([appointmentRow({ id: "appt-1", patient: "patient-1" })]) // lookup por id
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor (ya excluye la propia cita en el filtro de JS)
      .mockResolvedValueOnce([]) // blockingAppointmentsForPatientInClinic (idem)
      .mockResolvedValueOnce([]) // timeOffForDoctor: sin ausencias
      .mockResolvedValueOnce(
        appointmentRow({ id: "appt-1", patient: "patient-1", inicio: "2026-07-14T09:00:00.000-05:00" }),
      ); // updateItem

    const result = await rescheduleAppointment("appt-1", CLINIC_ID, ["patient-1"], new Date("2026-07-14T14:00:00.000Z"));
    expect(result.id).toBe("appt-1");
  });

  it("no se bloquea a sí misma: ignora su propia fila al chequear solapes", async () => {
    const self = appointmentRow({ id: "appt-1", patient: "patient-1" });
    requestMock
      .mockResolvedValueOnce([self]) // lookup por id
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([self]) // blockingAppointmentsForDoctor devuelve la misma fila que se está moviendo
      .mockResolvedValueOnce([self]) // blockingAppointmentsForPatientInClinic: idem, también se filtra por id
      .mockResolvedValueOnce([]) // timeOffForDoctor: sin ausencias
      .mockResolvedValueOnce(self); // updateItem: como se filtra a sí misma, no hay solape real

    await expect(
      rescheduleAppointment("appt-1", CLINIC_ID, ["patient-1"], new Date("2026-07-13T13:00:00.000Z")),
    ).resolves.toBeDefined();
  });

  it("rechaza si el nuevo horario choca con otra cita", async () => {
    requestMock
      .mockResolvedValueOnce([appointmentRow({ id: "appt-1", patient: "patient-1" })]) // lookup
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([appointmentRow({ id: "appt-otra", patient: "patient-2" })]); // otra cita en el nuevo horario

    await expect(
      rescheduleAppointment("appt-1", CLINIC_ID, ["patient-1"], new Date("2026-07-13T13:00:00.000Z")),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("rechaza si el paciente ya tiene otra cita que se traslapa en la misma clínica, con OTRO médico", async () => {
    requestMock
      .mockResolvedValueOnce([appointmentRow({ id: "appt-1", patient: "patient-1" })]) // lookup
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor: este médico tiene la agenda libre
      .mockResolvedValueOnce([
        appointmentRow({ id: "appt-otro-medico", doctor: "doctor-2", patient: "patient-1" }),
      ]); // blockingAppointmentsForPatientInClinic: el paciente ya tiene otra cita en ese horario con otro médico

    await expect(
      rescheduleAppointment("appt-1", CLINIC_ID, ["patient-1"], new Date("2026-07-13T13:00:00.000Z")),
    ).rejects.toBeInstanceOf(PatientScheduleConflictError);
  });

  it("rechaza si el nuevo horario cae dentro de una ausencia (time off) del odontólogo", async () => {
    requestMock
      .mockResolvedValueOnce([appointmentRow({ id: "appt-1", patient: "patient-1" })]) // lookup
      .mockResolvedValueOnce([SERVICE]) // getService
      .mockResolvedValueOnce([]) // blockingAppointmentsForDoctor: agenda vacía
      .mockResolvedValueOnce([]) // blockingAppointmentsForPatientInClinic: sin otras citas del paciente
      .mockResolvedValueOnce([
        { id: "to-1", doctor: "doctor-1", inicio: "2026-07-13T13:00:00.000Z", fin: "2026-07-13T18:00:00.000Z" },
      ]); // timeOffForDoctor: odontólogo ausente 08:00-13:00 local

    await expect(
      rescheduleAppointment("appt-1", CLINIC_ID, ["patient-1"], new Date("2026-07-13T14:00:00.000Z")), // 09:00 local
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("rechaza si la cita no pertenece al paciente que la pide (IDOR)", async () => {
    requestMock.mockResolvedValueOnce([appointmentRow({ id: "appt-1", patient: "patient-other" })]); // lookup

    await expect(
      rescheduleAppointment("appt-1", CLINIC_ID, ["patient-1"], new Date("2026-07-13T13:00:00.000Z")),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
    expect(requestMock).toHaveBeenCalledTimes(1); // no sigue de largo a getService/blockingAppointments
  });

  it("rechaza si la cita no existe", async () => {
    requestMock.mockResolvedValueOnce([]); // lookup vacío

    await expect(
      rescheduleAppointment("appt-inexistente", CLINIC_ID, ["patient-1"], new Date("2026-07-13T13:00:00.000Z")),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });
});

describe("cancelAppointment", () => {
  it("cancela la cita cuando pertenece al paciente", async () => {
    requestMock
      .mockResolvedValueOnce([appointmentRow({ id: "appt-1", patient: "patient-1" })]) // lookup
      .mockResolvedValueOnce(appointmentRow({ id: "appt-1", patient: "patient-1", estado: "cancelada" })); // updateItem

    await cancelAppointment("appt-1", CLINIC_ID, ["patient-1"]);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("rechaza si la cita no pertenece al paciente que la pide (IDOR)", async () => {
    requestMock.mockResolvedValueOnce([appointmentRow({ id: "appt-1", patient: "patient-other" })]); // lookup

    await expect(cancelAppointment("appt-1", CLINIC_ID, ["patient-1"])).rejects.toBeInstanceOf(AppointmentNotFoundError);
    expect(requestMock).toHaveBeenCalledTimes(1); // nunca llega al updateItem
  });

  it("permite cancelar la cita de un familiar del mismo número (ownership por grupo)", async () => {
    requestMock
      .mockResolvedValueOnce([appointmentRow({ id: "appt-hijo", patient: "patient-hijo" })]) // lookup
      .mockResolvedValueOnce(appointmentRow({ id: "appt-hijo", patient: "patient-hijo", estado: "cancelada" })); // updateItem

    // El titular gestiona con el grupo de su número (madre + hijo).
    await cancelAppointment("appt-hijo", CLINIC_ID, ["patient-madre", "patient-hijo"]);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
