import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "test-static-token";
const TEL = "+50688000001";
const CLINIC_ID = "clinic-1";

vi.mock("./config.js", () => ({
  config: {
    BOOKING_PUBLIC_LINK_TOKEN: TOKEN,
    PUBLIC_BOOKING_CORS_ORIGINS: "https://panel.egonia.site,http://localhost:5173",
    CLINIC_TIMEZONE: "America/Costa_Rica",
  },
}));

const listActiveDoctorsMock = vi.fn();
const listActiveServicesMock = vi.fn();
const listActiveSpecialtiesMock = vi.fn();
const getAvailableSlotsMock = vi.fn();
const bookAppointmentMock = vi.fn();
const findOrCreatePatientMock = vi.fn();
const findTitularByPhoneMock = vi.fn();
const updatePatientNameMock = vi.fn();
const resolveOrCreateHouseholdPatientMock = vi.fn();
const getClinicByIdMock = vi.fn();

class MockSlotUnavailableError extends Error {
  constructor() {
    super("El horario solicitado ya no está disponible.");
    this.name = "SlotUnavailableError";
  }
}

vi.mock("./repositories/doctors.js", () => ({ listActiveDoctors: listActiveDoctorsMock }));
vi.mock("./repositories/services.js", () => ({ listActiveServices: listActiveServicesMock }));
vi.mock("./repositories/specialties.js", () => ({ listActiveSpecialties: listActiveSpecialtiesMock }));
vi.mock("./repositories/availability.js", () => ({ getAvailableSlots: getAvailableSlotsMock }));
vi.mock("./repositories/appointments.js", () => ({
  bookAppointment: bookAppointmentMock,
  SlotUnavailableError: MockSlotUnavailableError,
}));
vi.mock("./repositories/patients.js", () => ({
  findOrCreatePatient: findOrCreatePatientMock,
  findTitularByPhone: findTitularByPhoneMock,
  updatePatientName: updatePatientNameMock,
  resolveOrCreateHouseholdPatient: resolveOrCreateHouseholdPatientMock,
}));
vi.mock("./repositories/clinics.js", () => ({ getClinicById: getClinicByIdMock }));

const { publicBookingRouter } = await import("./publicBooking.js");

describe("publicBookingRouter (HTTP, token estático)", () => {
  let server: import("node:http").Server;
  let baseUrl: string;

  beforeEach(async () => {
    listActiveDoctorsMock.mockReset().mockResolvedValue([{ id: "d1", nombre: "Dr. Uno", activo: true, specialtyId: "sp-odon" }]);
    listActiveServicesMock
      .mockReset()
      .mockResolvedValue([{ id: "s1", nombre: "Limpieza", duracionMin: 30, bufferMin: 0, activo: true, specialtyId: "sp-odon" }]);
    listActiveSpecialtiesMock
      .mockReset()
      .mockResolvedValue([{ id: "sp-odon", nombre: "Odontología", activo: true }]);
    getAvailableSlotsMock.mockReset().mockResolvedValue([
      {
        doctorId: "d1",
        inicio: new Date("2026-07-20T13:00:00.000Z"),
        fin: new Date("2026-07-20T13:30:00.000Z"),
      },
    ]);
    bookAppointmentMock.mockReset();
    findOrCreatePatientMock.mockReset().mockResolvedValue({ id: "patient-1", telefono: TEL });
    findTitularByPhoneMock.mockReset().mockResolvedValue(null);
    updatePatientNameMock.mockReset().mockResolvedValue(undefined);
    resolveOrCreateHouseholdPatientMock.mockReset();
    getClinicByIdMock.mockReset().mockResolvedValue({ id: CLINIC_ID, nombre: "Clínica Principal", activo: true });

    const app = express();
    app.use(express.json());
    app.use("/public/booking", publicBookingRouter);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("verificación del token", () => {
    it("rechaza con 401 si falta el token", async () => {
      const res = await fetch(`${baseUrl}/public/booking/context`);
      expect(res.status).toBe(401);
    });

    it("rechaza con 401 si el token no coincide", async () => {
      const res = await fetch(`${baseUrl}/public/booking/context?token=incorrecto`);
      expect(res.status).toBe(401);
    });

    it("acepta con el token correcto", async () => {
      const res = await fetch(`${baseUrl}/public/booking/context?token=${TOKEN}&clinica=${CLINIC_ID}`);
      expect(res.status).toBe(200);
    });
  });

  describe("GET /context", () => {
    it("devuelve especialidades, médicos y servicios (con su specialtyId; sin datos de paciente, ya no hay teléfono asociado al link)", async () => {
      const res = await fetch(`${baseUrl}/public/booking/context?token=${TOKEN}&clinica=${CLINIC_ID}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        clinicName: "Clínica Principal",
        specialties: [{ id: "sp-odon", nombre: "Odontología" }],
        doctors: [{ id: "d1", nombre: "Dr. Uno", specialtyId: "sp-odon" }],
        services: [{ id: "s1", nombre: "Limpieza", duracionMin: 30, specialtyId: "sp-odon" }],
      });
    });
  });

  describe("GET /availability", () => {
    it("devuelve los horarios disponibles como ISO strings", async () => {
      const params = new URLSearchParams({
        token: TOKEN,
        clinica: CLINIC_ID,
        doctorId: "d1",
        serviceId: "s1",
        from: "2026-07-20",
        to: "2026-07-20",
      });
      const res = await fetch(`${baseUrl}/public/booking/availability?${params.toString()}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ slots: ["2026-07-20T13:00:00.000Z"] });
      expect(getAvailableSlotsMock).toHaveBeenCalledWith(
        expect.objectContaining({ serviceId: "s1", doctorId: "d1" }),
      );
    });

    it("pide horas cada 30 minutos, no cada 15 (paso real del bot)", async () => {
      const params = new URLSearchParams({
        token: TOKEN,
        clinica: CLINIC_ID,
        doctorId: "d1",
        serviceId: "s1",
        from: "2026-07-20",
        to: "2026-07-20",
      });
      await fetch(`${baseUrl}/public/booking/availability?${params.toString()}`);
      expect(getAvailableSlotsMock).toHaveBeenCalledWith(expect.objectContaining({ stepMinutes: 30 }));
    });

    it("rechaza con 400 si faltan parámetros", async () => {
      const res = await fetch(`${baseUrl}/public/booking/availability?token=${TOKEN}&clinica=${CLINIC_ID}`);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /titular", () => {
    it("devuelve el nombre si ya hay un titular con nombre bajo ese número", async () => {
      findTitularByPhoneMock.mockResolvedValue({ id: "patient-1", telefono: TEL, nombre: "María", titular: true });

      const res = await fetch(`${baseUrl}/public/booking/titular?token=${TOKEN}&clinica=${CLINIC_ID}&telefono=${encodeURIComponent(TEL)}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ nombre: "María" });
      expect(findTitularByPhoneMock).toHaveBeenCalledWith(TEL, CLINIC_ID);
    });

    it("devuelve nombre null si el número no tiene titular todavía (no crea nada)", async () => {
      findTitularByPhoneMock.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/public/booking/titular?token=${TOKEN}&clinica=${CLINIC_ID}&telefono=${encodeURIComponent(TEL)}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ nombre: null });
    });

    it("devuelve nombre null si el titular existe pero aún no tiene nombre", async () => {
      findTitularByPhoneMock.mockResolvedValue({ id: "patient-1", telefono: TEL, titular: true });

      const res = await fetch(`${baseUrl}/public/booking/titular?token=${TOKEN}&clinica=${CLINIC_ID}&telefono=${encodeURIComponent(TEL)}`);
      expect(await res.json()).toEqual({ nombre: null });
    });

    it("rechaza con 400 si el teléfono no tiene formato válido", async () => {
      const res = await fetch(`${baseUrl}/public/booking/titular?token=${TOKEN}&clinica=${CLINIC_ID}&telefono=no-es-un-telefono`);
      expect(res.status).toBe(400);
      expect(findTitularByPhoneMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /appointments", () => {
    const APPOINTMENT_BODY = {
      doctorId: "d1",
      serviceId: "s1",
      inicio: "2026-07-20T13:00:00.000Z",
    };
    const CREATED_ROW = {
      id: "appt-1",
      doctorId: "d1",
      patientId: "patient-1",
      serviceId: "s1",
      inicio: new Date("2026-07-20T13:00:00.000Z"),
      fin: new Date("2026-07-20T13:30:00.000Z"),
      estado: "pendiente" as const,
    };

    it("agenda la cita a partir del teléfono ingresado por la propia persona", async () => {
      bookAppointmentMock.mockResolvedValue(CREATED_ROW);
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL, nombre: "Juan Pérez", ...APPOINTMENT_BODY }),
      });
      expect(res.status).toBe(201);
      expect(findOrCreatePatientMock).toHaveBeenCalledWith(TEL, CLINIC_ID);
      expect(updatePatientNameMock).toHaveBeenCalledWith("patient-1", "Juan Pérez");
      expect(bookAppointmentMock).toHaveBeenCalledWith({
        clinicId: CLINIC_ID,
        doctorId: "d1",
        patientId: "patient-1",
        serviceId: "s1",
        inicio: new Date("2026-07-20T13:00:00.000Z"),
        origen: "link_publico",
      });
    });

    it("rechaza con 400 si el teléfono no tiene formato válido", async () => {
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: "no-es-un-telefono", ...APPOINTMENT_BODY }),
      });
      expect(res.status).toBe(400);
      expect(findOrCreatePatientMock).not.toHaveBeenCalled();
    });

    it("no actualiza el nombre si no cambió", async () => {
      findOrCreatePatientMock.mockResolvedValue({ id: "patient-1", telefono: TEL, nombre: "Juan Pérez" });
      bookAppointmentMock.mockResolvedValue(CREATED_ROW);
      await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL, nombre: "Juan Pérez", ...APPOINTMENT_BODY }),
      });
      expect(updatePatientNameMock).not.toHaveBeenCalled();
    });

    it("no sobrescribe el nombre del titular aunque el formulario traiga uno distinto (puede ser un familiar reservando con el mismo teléfono)", async () => {
      findOrCreatePatientMock.mockResolvedValue({ id: "patient-1", telefono: TEL, nombre: "María" });
      bookAppointmentMock.mockResolvedValue(CREATED_ROW);
      await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL, nombre: "Juan", ...APPOINTMENT_BODY }),
      });
      expect(updatePatientNameMock).not.toHaveBeenCalled();
    });

    it("con pacienteNombre agenda para esa persona bajo el mismo teléfono, no para el titular", async () => {
      findOrCreatePatientMock.mockResolvedValue({ id: "patient-1", telefono: TEL, nombre: "María" });
      resolveOrCreateHouseholdPatientMock.mockResolvedValue({
        patient: { id: "patient-hijo", telefono: TEL, nombre: "Juan", titular: false },
        ambiguous: false,
      });
      bookAppointmentMock.mockResolvedValue(CREATED_ROW);

      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL, nombre: "María", pacienteNombre: "Juan", ...APPOINTMENT_BODY }),
      });

      expect(res.status).toBe(201);
      expect(resolveOrCreateHouseholdPatientMock).toHaveBeenCalledWith(TEL, "Juan", CLINIC_ID);
      expect(bookAppointmentMock).toHaveBeenCalledWith(expect.objectContaining({ patientId: "patient-hijo" }));
    });

    it("responde 400 si pacienteNombre es ambiguo entre varios familiares del mismo número", async () => {
      resolveOrCreateHouseholdPatientMock.mockResolvedValue({
        patient: { id: "patient-a", telefono: TEL, nombre: "Juan", titular: false },
        ambiguous: true,
      });

      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL, nombre: "María", pacienteNombre: "Juan", ...APPOINTMENT_BODY }),
      });

      expect(res.status).toBe(400);
      expect(bookAppointmentMock).not.toHaveBeenCalled();
    });

    it("responde 409 si el horario ya no está disponible", async () => {
      bookAppointmentMock.mockRejectedValue(new MockSlotUnavailableError());
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL, ...APPOINTMENT_BODY }),
      });
      expect(res.status).toBe(409);
    });

    it("responde 400 si faltan campos", async () => {
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL }),
      });
      expect(res.status).toBe(400);
      expect(bookAppointmentMock).not.toHaveBeenCalled();
    });

    it("rechaza con 401 si el token no es válido, sin llegar a agendar", async () => {
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "malo", clinica: CLINIC_ID, telefono: TEL, ...APPOINTMENT_BODY }),
      });
      expect(res.status).toBe(401);
      expect(bookAppointmentMock).not.toHaveBeenCalled();
    });
  });

  describe("CORS", () => {
    it("refleja Access-Control-Allow-Origin si el origen está permitido", async () => {
      const res = await fetch(`${baseUrl}/public/booking/context?token=${TOKEN}&clinica=${CLINIC_ID}`, {
        headers: { Origin: "https://panel.egonia.site" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBe("https://panel.egonia.site");
    });

    it("no agrega el header si el origen no está permitido", async () => {
      const res = await fetch(`${baseUrl}/public/booking/context?token=${TOKEN}&clinica=${CLINIC_ID}`, {
        headers: { Origin: "https://evil.example.com" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
