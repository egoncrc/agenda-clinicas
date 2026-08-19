import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "test-static-token";
const TEL = "+50688000001";
/** Formato local (sin +506) en que queda guardado `patients.telefono` una vez normalizado. */
const TEL_LOCAL = "88000001";
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
const listPatientsByPhoneMock = vi.fn();
const getPatientMock = vi.fn();
const createDependentPatientMock = vi.fn();
const updatePatientNameMock = vi.fn();
const getClinicByIdMock = vi.fn();

class MockSlotUnavailableError extends Error {
  constructor() {
    super("El horario solicitado ya no está disponible.");
    this.name = "SlotUnavailableError";
  }
}

class MockPatientScheduleConflictError extends Error {
  constructor() {
    super("Ya tienes otra cita en ese horario en esta misma clínica.");
    this.name = "PatientScheduleConflictError";
  }
}

vi.mock("./repositories/doctors.js", () => ({ listActiveDoctors: listActiveDoctorsMock }));
vi.mock("./repositories/services.js", () => ({ listActiveServices: listActiveServicesMock }));
vi.mock("./repositories/specialties.js", () => ({ listActiveSpecialties: listActiveSpecialtiesMock }));
vi.mock("./repositories/availability.js", () => ({ getAvailableSlots: getAvailableSlotsMock }));
vi.mock("./repositories/appointments.js", () => ({
  bookAppointment: bookAppointmentMock,
  SlotUnavailableError: MockSlotUnavailableError,
  PatientScheduleConflictError: MockPatientScheduleConflictError,
}));
vi.mock("./repositories/patients.js", () => ({
  findOrCreatePatient: findOrCreatePatientMock,
  listPatientsByPhone: listPatientsByPhoneMock,
  getPatient: getPatientMock,
  createDependentPatient: createDependentPatientMock,
  updatePatientName: updatePatientNameMock,
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
    findOrCreatePatientMock.mockReset().mockResolvedValue({ id: "patient-1", telefono: TEL_LOCAL });
    listPatientsByPhoneMock.mockReset().mockResolvedValue([]);
    getPatientMock.mockReset();
    createDependentPatientMock.mockReset();
    updatePatientNameMock.mockReset().mockResolvedValue(undefined);
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

  describe("GET /household", () => {
    it("devuelve a todas las personas registradas bajo ese número, titular y familiares", async () => {
      listPatientsByPhoneMock.mockResolvedValue([
        { id: "patient-1", telefono: TEL_LOCAL, nombre: "María", titular: true },
        { id: "patient-2", telefono: TEL_LOCAL, nombre: "Juan", titular: false },
      ]);

      const res = await fetch(`${baseUrl}/public/booking/household?token=${TOKEN}&clinica=${CLINIC_ID}&telefono=${encodeURIComponent(TEL)}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        patients: [
          { id: "patient-1", nombre: "María", titular: true },
          { id: "patient-2", nombre: "Juan", titular: false },
        ],
      });
      expect(listPatientsByPhoneMock).toHaveBeenCalledWith(TEL_LOCAL, CLINIC_ID);
    });

    it("devuelve lista vacía si el número no tiene a nadie todavía (no crea nada)", async () => {
      listPatientsByPhoneMock.mockResolvedValue([]);

      const res = await fetch(`${baseUrl}/public/booking/household?token=${TOKEN}&clinica=${CLINIC_ID}&telefono=${encodeURIComponent(TEL)}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ patients: [] });
    });

    it("una persona sin nombre aparece con nombre null, no se filtra", async () => {
      listPatientsByPhoneMock.mockResolvedValue([{ id: "patient-1", telefono: TEL_LOCAL, titular: true }]);

      const res = await fetch(`${baseUrl}/public/booking/household?token=${TOKEN}&clinica=${CLINIC_ID}&telefono=${encodeURIComponent(TEL)}`);
      expect(await res.json()).toEqual({ patients: [{ id: "patient-1", nombre: null, titular: true }] });
    });

    it("rechaza con 400 si el teléfono no tiene formato válido", async () => {
      const res = await fetch(`${baseUrl}/public/booking/household?token=${TOKEN}&clinica=${CLINIC_ID}&telefono=no-es-un-telefono`);
      expect(res.status).toBe(400);
      expect(listPatientsByPhoneMock).not.toHaveBeenCalled();
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

    it("con nombre (número sin nadie todavía) crea al titular y agenda para él", async () => {
      bookAppointmentMock.mockResolvedValue(CREATED_ROW);
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL, nombre: "Juan Pérez", ...APPOINTMENT_BODY }),
      });
      expect(res.status).toBe(201);
      expect(findOrCreatePatientMock).toHaveBeenCalledWith(TEL_LOCAL, CLINIC_ID);
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

    it("no actualiza el nombre del titular si ya tenía uno", async () => {
      findOrCreatePatientMock.mockResolvedValue({ id: "patient-1", telefono: TEL_LOCAL, nombre: "Juan Pérez" });
      bookAppointmentMock.mockResolvedValue(CREATED_ROW);
      await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL_LOCAL, nombre: "Juan Pérez", ...APPOINTMENT_BODY }),
      });
      expect(updatePatientNameMock).not.toHaveBeenCalled();
    });

    it("con patientId agenda para la persona ya elegida de GET /household, sin crear ni renombrar a nadie", async () => {
      getPatientMock.mockResolvedValue({ id: "patient-hijo", telefono: TEL_LOCAL, nombre: "Juan", titular: false, clinic: CLINIC_ID });
      bookAppointmentMock.mockResolvedValue(CREATED_ROW);

      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL_LOCAL, patientId: "patient-hijo", ...APPOINTMENT_BODY }),
      });

      expect(res.status).toBe(201);
      expect(getPatientMock).toHaveBeenCalledWith("patient-hijo", CLINIC_ID);
      expect(findOrCreatePatientMock).not.toHaveBeenCalled();
      expect(updatePatientNameMock).not.toHaveBeenCalled();
      expect(bookAppointmentMock).toHaveBeenCalledWith(expect.objectContaining({ patientId: "patient-hijo" }));
    });

    it("responde 400 si el patientId no corresponde al teléfono indicado (ni tampoco si no existe: mismo chequeo)", async () => {
      getPatientMock.mockResolvedValue({ id: "patient-otro", telefono: "+50699999999", nombre: "Otra", titular: true, clinic: CLINIC_ID });

      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL_LOCAL, patientId: "patient-otro", ...APPOINTMENT_BODY }),
      });

      expect(res.status).toBe(400);
      expect(bookAppointmentMock).not.toHaveBeenCalled();
    });

    it("con pacienteNombre (número con gente ya registrada) crea un familiar nuevo y agenda para él", async () => {
      createDependentPatientMock.mockResolvedValue({ id: "patient-hijo2", telefono: TEL_LOCAL, nombre: "Pedro", titular: false });
      bookAppointmentMock.mockResolvedValue(CREATED_ROW);

      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL_LOCAL, pacienteNombre: "Pedro", ...APPOINTMENT_BODY }),
      });

      expect(res.status).toBe(201);
      expect(createDependentPatientMock).toHaveBeenCalledWith(TEL_LOCAL, "Pedro", CLINIC_ID);
      expect(findOrCreatePatientMock).not.toHaveBeenCalled();
      expect(bookAppointmentMock).toHaveBeenCalledWith(expect.objectContaining({ patientId: "patient-hijo2" }));
    });

    it("responde 409 si el horario ya no está disponible", async () => {
      bookAppointmentMock.mockRejectedValue(new MockSlotUnavailableError());
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL_LOCAL, nombre: "Juan", ...APPOINTMENT_BODY }),
      });
      expect(res.status).toBe(409);
    });

    it("responde 409 si el paciente ya tiene otra cita que se traslapa en esta clínica", async () => {
      bookAppointmentMock.mockRejectedValue(new MockPatientScheduleConflictError());
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL_LOCAL, nombre: "Juan", ...APPOINTMENT_BODY }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Ya tienes otra cita en ese horario en esta misma clínica." });
    });

    it("responde 400 si no se indica ni patientId, ni nombre, ni pacienteNombre", async () => {
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL_LOCAL, ...APPOINTMENT_BODY }),
      });
      expect(res.status).toBe(400);
      expect(bookAppointmentMock).not.toHaveBeenCalled();
    });

    it("responde 400 si faltan campos", async () => {
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, clinica: CLINIC_ID, telefono: TEL_LOCAL }),
      });
      expect(res.status).toBe(400);
      expect(bookAppointmentMock).not.toHaveBeenCalled();
    });

    it("rechaza con 401 si el token no es válido, sin llegar a agendar", async () => {
      const res = await fetch(`${baseUrl}/public/booking/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "malo", clinica: CLINIC_ID, telefono: TEL_LOCAL, ...APPOINTMENT_BODY }),
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
