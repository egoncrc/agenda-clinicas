import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import type { AppointmentRow, ClinicRow } from "../directus.js";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
const { sendTemplateMock } = vi.hoisted(() => ({ sendTemplateMock: vi.fn() }));
const { logMessageMock } = vi.hoisted(() => ({ logMessageMock: vi.fn() }));
const { getPatientMock } = vi.hoisted(() => ({ getPatientMock: vi.fn() }));
const { getServiceMock } = vi.hoisted(() => ({ getServiceMock: vi.fn() }));
const { getDoctorMock } = vi.hoisted(() => ({ getDoctorMock: vi.fn() }));

vi.mock("../directus.js", () => ({ directus: { request: requestMock } }));
vi.mock("../whatsapp/ycloud.js", () => ({ sendTemplate: sendTemplateMock }));
vi.mock("./messages.js", () => ({ logMessage: logMessageMock }));
vi.mock("./patients.js", () => ({ getPatient: getPatientMock }));
vi.mock("./services.js", () => ({ getService: getServiceMock }));
vi.mock("./doctors.js", () => ({ getDoctor: getDoctorMock }));

const { findAppointmentsDueForReminder, sendReminder, runReminderJob } = await import("./reminders.js");

const NOW = DateTime.fromISO("2026-07-12T10:00:00", { zone: "America/Guayaquil" }); // 24h antes de la cita

const CLINIC: ClinicRow = { id: "clinic-1", nombre: "Clínica Principal", activo: true, zona_horaria: "America/Guayaquil" };

function appointmentRow(overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: "appt-1",
    clinic: CLINIC.id,
    doctor: "doctor-1",
    patient: "patient-1",
    service: "svc-1",
    inicio: "2026-07-13T10:00:00.000-05:00",
    fin: "2026-07-13T10:30:00.000-05:00",
    estado: "pendiente",
    origen: "whatsapp",
    recordatorio_24h_enviado: false,
    recordatorio_2h_enviado: false,
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  sendTemplateMock.mockReset();
  logMessageMock.mockReset();
  getPatientMock.mockReset();
  getServiceMock.mockReset();
  getDoctorMock.mockReset();

  getPatientMock.mockResolvedValue({ id: "patient-1", telefono: "+50688000001", nombre: "Ana" });
  getServiceMock.mockResolvedValue({ id: "svc-1", nombre: "Limpieza dental", duracionMin: 30, bufferMin: 10, activo: true });
  getDoctorMock.mockResolvedValue({ id: "doctor-1", nombre: "Dr. Rodolfo Sánchez", activo: true });
});

describe("findAppointmentsDueForReminder", () => {
  it("devuelve la cita con el kind 24h cuando se abre esa ventana", async () => {
    requestMock.mockResolvedValueOnce([appointmentRow()]);

    const due = await findAppointmentsDueForReminder(CLINIC.id, NOW);

    expect(due).toEqual([{ row: appointmentRow(), kind: "24h" }]);
  });

  it("no devuelve nada si aún falta mucho para la cita", async () => {
    requestMock.mockResolvedValueOnce([appointmentRow()]);

    const due = await findAppointmentsDueForReminder(CLINIC.id, NOW.minus({ days: 2 }));

    expect(due).toEqual([]);
  });
});

describe("sendReminder", () => {
  it("envía la plantilla, loguea el mensaje y marca el flag", async () => {
    requestMock.mockResolvedValueOnce(undefined); // updateItem

    await sendReminder(CLINIC, appointmentRow(), "24h");

    expect(sendTemplateMock).toHaveBeenCalledWith(
      "+50688000001",
      "recordatorio_cita_24h",
      "es",
      ["Ana", "Limpieza dental", "Dr. Rodolfo Sánchez", expect.any(String)],
      CLINIC,
    );
    expect(logMessageMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledTimes(1); // solo el updateItem
  });

  it("no marca el flag si el envío falla", async () => {
    sendTemplateMock.mockRejectedValueOnce(new Error("YCloud API error"));

    await expect(sendReminder(CLINIC, appointmentRow(), "2h")).rejects.toThrow("YCloud API error");

    expect(requestMock).not.toHaveBeenCalled(); // nunca llega al updateItem
  });
});

describe("runReminderJob", () => {
  it("sigue con las demás citas aunque una falle", async () => {
    requestMock
      .mockResolvedValueOnce([appointmentRow({ id: "appt-ok" }), appointmentRow({ id: "appt-fail" })])
      .mockResolvedValueOnce(undefined); // updateItem de appt-ok

    sendTemplateMock
      .mockResolvedValueOnce(undefined) // appt-ok
      .mockRejectedValueOnce(new Error("boom")); // appt-fail

    const summary = await runReminderJob(CLINIC, NOW);

    expect(summary).toEqual({ enviados: 1, fallidos: 1 });
  });
});
