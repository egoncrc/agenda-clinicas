import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import type { ClinicRow, WaitlistRow } from "../directus.js";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
const { getAvailableSlotsMock } = vi.hoisted(() => ({ getAvailableSlotsMock: vi.fn() }));
const { bookAppointmentMock } = vi.hoisted(() => ({ bookAppointmentMock: vi.fn() }));
const { sendTemplateMock } = vi.hoisted(() => ({ sendTemplateMock: vi.fn() }));
const { logMessageMock } = vi.hoisted(() => ({ logMessageMock: vi.fn() }));
const { getPatientMock } = vi.hoisted(() => ({ getPatientMock: vi.fn() }));
const { getServiceMock } = vi.hoisted(() => ({ getServiceMock: vi.fn() }));
const { getDoctorMock } = vi.hoisted(() => ({ getDoctorMock: vi.fn() }));

vi.mock("../directus.js", () => ({ directus: { request: requestMock } }));
vi.mock("./availability.js", () => ({ getAvailableSlots: getAvailableSlotsMock }));
vi.mock("../whatsapp/ycloud.js", () => ({ sendTemplate: sendTemplateMock }));
vi.mock("./messages.js", () => ({ logMessage: logMessageMock }));
vi.mock("./patients.js", () => ({ getPatient: getPatientMock }));
vi.mock("./services.js", () => ({ getService: getServiceMock }));
vi.mock("./doctors.js", () => ({ getDoctor: getDoctorMock }));

// appointments.js no se mockea entero: se usa la SlotUnavailableError real,
// pero se sustituye bookAppointment por un mock controlable.
vi.mock("./appointments.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./appointments.js")>();
  return { ...actual, bookAppointment: bookAppointmentMock };
});

const {
  addToWaitlist,
  cancelWaitlistEntry,
  runWaitlistMatchingJob,
  WaitlistEntryNotFoundError,
} = await import("./waitlist.js");
const { SlotUnavailableError } = await import("./appointments.js");

const CLINIC: ClinicRow = { id: "clinic-1", nombre: "Clínica Principal", activo: true, zona_horaria: "America/Guayaquil" };

function waitlistRow(overrides: Partial<WaitlistRow> = {}): WaitlistRow {
  return {
    id: "wl-1",
    clinic: CLINIC.id,
    patient: "patient-1",
    service: "svc-1",
    doctor: null,
    dia_semana: null,
    hora_desde: null,
    hora_hasta: null,
    estado: "activa",
    oferta_inicio: null,
    oferta_expira: null,
    oferta_doctor: null,
    appointment_generada: null,
    notas: null,
    date_created: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

/** El SDK de Directus pasa a `directus.request` un thunk que arma el request real; para inspeccionar el payload de la última llamada hay que ejecutarlo. */
function lastRequestBody(): unknown {
  const thunk = requestMock.mock.calls.at(-1)?.[0] as () => { body: string };
  return JSON.parse(thunk().body);
}

beforeEach(() => {
  requestMock.mockReset();
  getAvailableSlotsMock.mockReset();
  bookAppointmentMock.mockReset();
  sendTemplateMock.mockReset();
  logMessageMock.mockReset();
  getPatientMock.mockReset();
  getServiceMock.mockReset();
  getDoctorMock.mockReset();

  getPatientMock.mockResolvedValue({ id: "patient-1", telefono: "+50688000001", nombre: "Ana" });
  getServiceMock.mockResolvedValue({ id: "svc-1", nombre: "Limpieza dental", duracionMin: 30, bufferMin: 10, activo: true });
  getDoctorMock.mockResolvedValue({ id: "doctor-1", nombre: "Dr. Rodolfo Sánchez", activo: true });
});

describe("addToWaitlist", () => {
  it("crea la entrada con estado activa", async () => {
    requestMock.mockResolvedValueOnce(waitlistRow());
    const entry = await addToWaitlist({ clinicId: CLINIC.id, patientId: "patient-1", serviceId: "svc-1" });
    expect(entry.estado).toBe("activa");
    expect(entry.id).toBe("wl-1");
  });
});

describe("cancelWaitlistEntry", () => {
  it("rechaza si la entrada no pertenece al número", async () => {
    requestMock.mockResolvedValueOnce([waitlistRow({ patient: "otro-paciente" })]);
    await expect(cancelWaitlistEntry("wl-1", CLINIC.id, ["patient-1"])).rejects.toBeInstanceOf(WaitlistEntryNotFoundError);
    expect(requestMock).toHaveBeenCalledTimes(1); // no llega al updateItem
  });

  it("marca cancelada si pertenece al número", async () => {
    requestMock.mockResolvedValueOnce([waitlistRow()]).mockResolvedValueOnce(undefined);
    await cancelWaitlistEntry("wl-1", CLINIC.id, ["patient-1"]);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});

describe("runWaitlistMatchingJob", () => {
  const NOW = DateTime.fromISO("2026-07-06T00:00:00", { zone: "America/Guayaquil" });
  const lunesSlot = { doctorId: "doctor-1", inicio: new Date("2026-07-13T14:00:00.000Z") };

  it("sin entradas activas, no hace nada", async () => {
    requestMock.mockResolvedValueOnce([]); // activas: ninguna

    const summary = await runWaitlistMatchingJob(CLINIC, NOW);

    expect(summary).toEqual({ agendadas: 0 });
    expect(bookAppointmentMock).not.toHaveBeenCalled();
  });

  it("agenda directo al encontrar un hueco compatible, sin pedir confirmación", async () => {
    requestMock
      .mockResolvedValueOnce([waitlistRow()]) // activas
      .mockResolvedValueOnce(undefined); // updateItem -> agendada
    getAvailableSlotsMock.mockResolvedValue([lunesSlot]);
    bookAppointmentMock.mockResolvedValueOnce({ id: "appt-nueva", estado: "pendiente" });

    const summary = await runWaitlistMatchingJob(CLINIC, NOW);

    expect(summary).toEqual({ agendadas: 1 });
    expect(bookAppointmentMock).toHaveBeenCalledWith({
      clinicId: CLINIC.id,
      doctorId: "doctor-1",
      patientId: "patient-1",
      serviceId: "svc-1",
      inicio: lunesSlot.inicio,
      origen: "lista_espera",
    });
    expect(lastRequestBody()).toMatchObject({ estado: "agendada", appointment_generada: "appt-nueva" });
    expect(sendTemplateMock).toHaveBeenCalledTimes(1);
  });

  it("si el hueco ya no está libre (carrera), sigue con la siguiente entrada sin dejar estado inconsistente", async () => {
    requestMock.mockResolvedValueOnce([waitlistRow()]); // activas, sin updateItem posterior
    getAvailableSlotsMock.mockResolvedValue([lunesSlot]);
    bookAppointmentMock.mockRejectedValueOnce(new SlotUnavailableError());

    const summary = await runWaitlistMatchingJob(CLINIC, NOW);

    expect(summary).toEqual({ agendadas: 0 });
    expect(requestMock).toHaveBeenCalledTimes(1); // solo el readItems, ningún updateItem
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it("procesa primero a la entrada con preferencia más específica", async () => {
    const generica = waitlistRow({ id: "wl-generica", patient: "patient-generica", date_created: "2026-07-01T00:00:00Z" });
    const especifica = waitlistRow({
      id: "wl-especifica",
      patient: "patient-especifica",
      dia_semana: 1,
      date_created: "2026-07-02T00:00:00Z",
    });

    requestMock
      .mockResolvedValueOnce([generica, especifica]) // activas (orden de llegada de Directus, no de prioridad)
      .mockResolvedValueOnce(undefined) // updateItem de la especifica
      .mockResolvedValueOnce(undefined); // updateItem de la generica
    getAvailableSlotsMock.mockResolvedValue([lunesSlot]);
    bookAppointmentMock.mockResolvedValue({ id: "appt-nueva", estado: "pendiente" });

    const summary = await runWaitlistMatchingJob(CLINIC, NOW);

    expect(summary.agendadas).toBe(2);
    expect(getPatientMock.mock.calls.map((c) => c[0])).toEqual(["patient-especifica", "patient-generica"]);
  });
});
