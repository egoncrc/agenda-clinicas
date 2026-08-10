import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment, Doctor, Service, Slot, WaitlistEntry } from "../domain/types.js";

const listActiveDoctorsMock = vi.fn();
const listActiveServicesMock = vi.fn();
const listActiveSpecialtiesMock = vi.fn();
const getAvailableSlotsMock = vi.fn();
const bookAppointmentMock = vi.fn();
const cancelAppointmentMock = vi.fn();
const listUpcomingAppointmentsForPatientsMock = vi.fn();
const rescheduleAppointmentMock = vi.fn();
const listPatientsByPhoneMock = vi.fn();
const resolveOrCreateHouseholdPatientMock = vi.fn();
const addToWaitlistMock = vi.fn();
const cancelWaitlistEntryMock = vi.fn();
const listWaitlistForPatientsMock = vi.fn();

vi.mock("../repositories/doctors.js", () => ({
  listActiveDoctors: listActiveDoctorsMock,
  getDoctor: vi.fn(),
}));
vi.mock("../repositories/services.js", () => ({
  listActiveServices: listActiveServicesMock,
  getService: vi.fn(),
}));
vi.mock("../repositories/specialties.js", () => ({
  listActiveSpecialties: listActiveSpecialtiesMock,
  getSpecialty: vi.fn(),
}));
vi.mock("../repositories/availability.js", () => ({
  getAvailableSlots: getAvailableSlotsMock,
}));
vi.mock("../repositories/patients.js", () => ({
  listPatientsByPhone: listPatientsByPhoneMock,
  resolveOrCreateHouseholdPatient: resolveOrCreateHouseholdPatientMock,
}));
vi.mock("../repositories/appointments.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repositories/appointments.js")>();
  return {
    ...actual,
    bookAppointment: bookAppointmentMock,
    cancelAppointment: cancelAppointmentMock,
    listUpcomingAppointmentsForPatients: listUpcomingAppointmentsForPatientsMock,
    rescheduleAppointment: rescheduleAppointmentMock,
  };
});
vi.mock("../repositories/waitlist.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repositories/waitlist.js")>();
  return {
    ...actual,
    addToWaitlist: addToWaitlistMock,
    cancelWaitlistEntry: cancelWaitlistEntryMock,
    listWaitlistForPatients: listWaitlistForPatientsMock,
  };
});

const { getToolHandler } = await import("./tools.js");
const { AppointmentNotFoundError, PatientScheduleConflictError, SlotUnavailableError } = await import(
  "../repositories/appointments.js"
);
const { WaitlistEntryNotFoundError } = await import("../repositories/waitlist.js");

const CLINIC = { id: "clinic-1", nombre: "Clínica Principal", activo: true, zona_horaria: "America/Guayaquil" };

const CTX = { telefono: "+50688000001", titularId: "patient-1", clinic: CLINIC };

/** Grupo por defecto del número: solo el titular (un paciente por teléfono). */
const HOUSEHOLD_TITULAR_ONLY = [{ id: "patient-1", telefono: "+50688000001", nombre: "María", titular: true }];

const DOCTORS: Doctor[] = [
  { id: "doctor-1", nombre: "Dr. Rodolfo Sánchez", activo: true, specialtyId: "sp-odon" },
  { id: "doctor-2", nombre: "Dra. Yendry Delgado", activo: true, specialtyId: "sp-odon" },
];

beforeEach(() => {
  listActiveDoctorsMock.mockReset().mockResolvedValue(DOCTORS);
  listActiveServicesMock.mockReset();
  listActiveSpecialtiesMock.mockReset();
  getAvailableSlotsMock.mockReset();
  bookAppointmentMock.mockReset();
  cancelAppointmentMock.mockReset();
  listUpcomingAppointmentsForPatientsMock.mockReset();
  rescheduleAppointmentMock.mockReset();
  listPatientsByPhoneMock.mockReset().mockResolvedValue(HOUSEHOLD_TITULAR_ONLY);
  resolveOrCreateHouseholdPatientMock.mockReset();
  addToWaitlistMock.mockReset();
  cancelWaitlistEntryMock.mockReset();
  listWaitlistForPatientsMock.mockReset();
});

function waitlistEntry(overrides: Partial<WaitlistEntry> = {}): WaitlistEntry {
  return {
    id: "wl-1",
    patientId: "patient-1",
    serviceId: "svc-1",
    estado: "activa",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

describe("list_services", () => {
  it("mapea id/nombre/duracionMin", async () => {
    const services: Service[] = [
      { id: "svc-1", nombre: "Limpieza dental", duracionMin: 30, bufferMin: 10, activo: true, specialtyId: "sp-odon" },
    ];
    listActiveServicesMock.mockResolvedValue(services);

    const result = await getToolHandler("list_services")!({} as never, CTX);
    expect(result).toEqual([{ id: "svc-1", nombre: "Limpieza dental", duracionMin: 30 }]);
  });

  it("propaga specialtyId al repositorio para filtrar por especialidad", async () => {
    listActiveServicesMock.mockResolvedValue([]);
    await getToolHandler("list_services")!({ specialtyId: "sp-odon" } as never, CTX);
    expect(listActiveServicesMock).toHaveBeenCalledWith("clinic-1", "sp-odon");
  });
});

describe("list_specialties", () => {
  it("lista id/nombre de las especialidades activas", async () => {
    listActiveSpecialtiesMock.mockResolvedValue([
      { id: "sp-odon", nombre: "Odontología", activo: true },
      { id: "sp-cardio", nombre: "Cardiología", activo: true },
    ]);
    const result = await getToolHandler("list_specialties")!({} as never, CTX);
    expect(result).toEqual([
      { id: "sp-odon", nombre: "Odontología" },
      { id: "sp-cardio", nombre: "Cardiología" },
    ]);
    expect(listActiveSpecialtiesMock).toHaveBeenCalledWith("clinic-1");
  });
});

describe("list_doctors", () => {
  it("mapea id/nombre/specialtyId y propaga specialtyId al repositorio", async () => {
    const result = await getToolHandler("list_doctors")!({ specialtyId: "sp-odon" } as never, CTX);
    expect(listActiveDoctorsMock).toHaveBeenCalledWith("clinic-1", "sp-odon");
    expect(result).toEqual([
      { id: "doctor-1", nombre: "Dr. Rodolfo Sánchez", specialtyId: "sp-odon" },
      { id: "doctor-2", nombre: "Dra. Yendry Delgado", specialtyId: "sp-odon" },
    ]);
  });
});

describe("check_availability", () => {
  it("resuelve el nombre del odontólogo y formatea la hora local", async () => {
    const slots: Slot[] = [
      { doctorId: "doctor-2", inicio: new Date("2026-07-14T14:00:00.000Z"), fin: new Date("2026-07-14T14:30:00.000Z") },
    ];
    getAvailableSlotsMock.mockResolvedValue(slots);

    const result = (await getToolHandler("check_availability")!(
      { serviceId: "svc-1", fromDate: "2026-07-14" } as never,
      CTX,
    )) as Array<{ doctorNombre: string; doctorId: string }>;

    expect(result).toHaveLength(1);
    expect(result[0]?.doctorId).toBe("doctor-2");
    expect(result[0]?.doctorNombre).toBe("Dra. Yendry Delgado");
  });

  it("propaga specialtyId a getAvailableSlots (búsqueda 'cualquier médico' acotada a la especialidad)", async () => {
    getAvailableSlotsMock.mockResolvedValue([]);
    await getToolHandler("check_availability")!(
      { serviceId: "svc-1", specialtyId: "sp-odon", fromDate: "2026-07-14" } as never,
      CTX,
    );
    expect(getAvailableSlotsMock).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: "clinic-1", serviceId: "svc-1", specialtyId: "sp-odon" }),
    );
  });

  it("devuelve un error legible si fromDate es inválida, sin llamar a getAvailableSlots", async () => {
    const result = await getToolHandler("check_availability")!(
      { serviceId: "svc-1", fromDate: "no-es-una-fecha" } as never,
      CTX,
    );
    expect(result).toEqual({ error: expect.stringContaining("fromDate inválida") });
    expect(getAvailableSlotsMock).not.toHaveBeenCalled();
  });

  it("recorta a 20 resultados", async () => {
    const slots: Slot[] = Array.from({ length: 30 }, (_, i) => ({
      doctorId: "doctor-1",
      inicio: new Date(Date.UTC(2026, 6, 14, 13, i)),
      fin: new Date(Date.UTC(2026, 6, 14, 13, i + 30)),
    }));
    getAvailableSlotsMock.mockResolvedValue(slots);

    const result = (await getToolHandler("check_availability")!(
      { serviceId: "svc-1", fromDate: "2026-07-14" } as never,
      CTX,
    )) as unknown[];
    expect(result).toHaveLength(20);
  });
});

describe("book_appointment", () => {
  it("reserva y devuelve el id de la cita", async () => {
    const appointment: Appointment = {
      id: "appt-1",
      doctorId: "doctor-1",
      patientId: "patient-1",
      serviceId: "svc-1",
      inicio: new Date("2026-07-14T14:00:00.000Z"),
      fin: new Date("2026-07-14T14:30:00.000Z"),
      estado: "pendiente",
    };
    bookAppointmentMock.mockResolvedValue(appointment);

    const result = await getToolHandler("book_appointment")!(
      { serviceId: "svc-1", doctorId: "doctor-1", startDateTime: "2026-07-14T09:00:00-05:00" } as never,
      CTX,
    );
    expect(result).toMatchObject({ appointmentId: "appt-1", estado: "pendiente" });
    // Sin pacienteNombre, la cita es para el titular del número.
    expect(bookAppointmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId: "doctor-1", patientId: "patient-1", serviceId: "svc-1" }),
    );
  });

  it("con pacienteNombre resuelve el paciente devuelto por resolveOrCreateHouseholdPatient (existente o nuevo)", async () => {
    resolveOrCreateHouseholdPatientMock.mockResolvedValue({
      patient: { id: "patient-hijo", telefono: "+50688000001", nombre: "Juan", titular: false },
      ambiguous: false,
    });
    bookAppointmentMock.mockResolvedValue({
      id: "appt-2", doctorId: "doctor-1", patientId: "patient-hijo", serviceId: "svc-1",
      inicio: new Date("2026-07-14T14:00:00.000Z"), fin: new Date("2026-07-14T14:30:00.000Z"), estado: "pendiente",
    });

    await getToolHandler("book_appointment")!(
      { serviceId: "svc-1", doctorId: "doctor-1", startDateTime: "2026-07-14T09:00:00-05:00", pacienteNombre: "Juan" } as never,
      CTX,
    );
    expect(resolveOrCreateHouseholdPatientMock).toHaveBeenCalledWith("+50688000001", "Juan", CLINIC.id);
    expect(bookAppointmentMock).toHaveBeenCalledWith(expect.objectContaining({ patientId: "patient-hijo" }));
  });

  it("con pacienteNombre ambiguo devuelve {error} y no reserva", async () => {
    resolveOrCreateHouseholdPatientMock.mockResolvedValue({
      patient: { id: "patient-hijo-1", telefono: "+50688000001", nombre: "Juan", titular: false },
      ambiguous: true,
    });

    const result = await getToolHandler("book_appointment")!(
      { serviceId: "svc-1", doctorId: "doctor-1", startDateTime: "2026-07-14T09:00:00-05:00", pacienteNombre: "Juan" } as never,
      CTX,
    );
    expect(result).toEqual({ error: expect.any(String) });
    expect(bookAppointmentMock).not.toHaveBeenCalled();
  });

  it("convierte SlotUnavailableError en {error} en vez de lanzar", async () => {
    bookAppointmentMock.mockRejectedValue(new SlotUnavailableError());

    const result = await getToolHandler("book_appointment")!(
      { serviceId: "svc-1", doctorId: "doctor-1", startDateTime: "2026-07-14T09:00:00-05:00" } as never,
      CTX,
    );
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("convierte PatientScheduleConflictError en {error} en vez de lanzar", async () => {
    bookAppointmentMock.mockRejectedValue(new PatientScheduleConflictError());

    const result = await getToolHandler("book_appointment")!(
      { serviceId: "svc-1", doctorId: "doctor-1", startDateTime: "2026-07-14T09:00:00-05:00" } as never,
      CTX,
    );
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("propaga errores inesperados (no de negocio)", async () => {
    bookAppointmentMock.mockRejectedValue(new Error("Directus caído"));

    await expect(
      getToolHandler("book_appointment")!(
        { serviceId: "svc-1", doctorId: "doctor-1", startDateTime: "2026-07-14T09:00:00-05:00" } as never,
        CTX,
      ),
    ).rejects.toThrow("Directus caído");
  });

  it("no llama a bookAppointment si startDateTime es inválida", async () => {
    const result = await getToolHandler("book_appointment")!(
      { serviceId: "svc-1", doctorId: "doctor-1", startDateTime: "fecha-invalida" } as never,
      CTX,
    );
    expect(result).toEqual({ error: expect.stringContaining("startDateTime inválida") });
    expect(bookAppointmentMock).not.toHaveBeenCalled();
  });
});

describe("cancel_appointment", () => {
  it("cancela y devuelve ok", async () => {
    cancelAppointmentMock.mockResolvedValue(undefined);
    const result = await getToolHandler("cancel_appointment")!({ appointmentId: "appt-1" } as never, CTX);
    expect(result).toEqual({ ok: true });
    // Ownership por grupo: se pasan los ids de todos los pacientes del número.
    // El motivo es opcional: si el paciente no lo dijo, no se inventa.
    expect(cancelAppointmentMock).toHaveBeenCalledWith("appt-1", CLINIC.id, ["patient-1"], undefined);
  });

  it("pasa el motivo cuando el paciente lo mencionó", async () => {
    cancelAppointmentMock.mockResolvedValue(undefined);
    const result = await getToolHandler("cancel_appointment")!(
      { appointmentId: "appt-1", motivo: "Me sale un viaje" } as never,
      CTX,
    );
    expect(result).toEqual({ ok: true });
    expect(cancelAppointmentMock).toHaveBeenCalledWith("appt-1", CLINIC.id, ["patient-1"], "Me sale un viaje");
  });

  it("convierte AppointmentNotFoundError en {error} en vez de lanzar (protege contra IDOR)", async () => {
    cancelAppointmentMock.mockRejectedValue(new AppointmentNotFoundError());
    const result = await getToolHandler("cancel_appointment")!({ appointmentId: "appt-ajena" } as never, CTX);
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("reschedule_appointment", () => {
  it("reprograma y devuelve la nueva hora", async () => {
    const appointment: Appointment = {
      id: "appt-1",
      doctorId: "doctor-1",
      patientId: "patient-1",
      serviceId: "svc-1",
      inicio: new Date("2026-07-14T14:00:00.000Z"),
      fin: new Date("2026-07-14T14:30:00.000Z"),
      estado: "pendiente",
    };
    rescheduleAppointmentMock.mockResolvedValue(appointment);

    const result = await getToolHandler("reschedule_appointment")!(
      { appointmentId: "appt-1", newStartDateTime: "2026-07-14T09:00:00-05:00" } as never,
      CTX,
    );
    expect(result).toMatchObject({ appointmentId: "appt-1" });
    expect(rescheduleAppointmentMock).toHaveBeenCalledWith(
      "appt-1",
      CLINIC.id,
      ["patient-1"],
      expect.any(Date),
    );
  });

  it("convierte AppointmentNotFoundError en {error} en vez de lanzar (protege contra IDOR)", async () => {
    rescheduleAppointmentMock.mockRejectedValue(new AppointmentNotFoundError());
    const result = await getToolHandler("reschedule_appointment")!(
      { appointmentId: "appt-ajena", newStartDateTime: "2026-07-14T09:00:00-05:00" } as never,
      CTX,
    );
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("convierte PatientScheduleConflictError en {error} en vez de lanzar", async () => {
    rescheduleAppointmentMock.mockRejectedValue(new PatientScheduleConflictError());
    const result = await getToolHandler("reschedule_appointment")!(
      { appointmentId: "appt-1", newStartDateTime: "2026-07-14T09:00:00-05:00" } as never,
      CTX,
    );
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("get_my_appointments", () => {
  it("lista las citas de todo el grupo con el nombre del paciente y del odontólogo", async () => {
    listPatientsByPhoneMock.mockResolvedValue([
      { id: "patient-1", telefono: "+50688000001", nombre: "María", titular: true },
      { id: "patient-hijo", telefono: "+50688000001", nombre: "Juan", titular: false },
    ]);
    const appointments: Appointment[] = [
      {
        id: "appt-1", doctorId: "doctor-1", patientId: "patient-1", serviceId: "svc-1",
        inicio: new Date("2026-07-14T14:00:00.000Z"), fin: new Date("2026-07-14T14:30:00.000Z"), estado: "confirmada",
      },
      {
        id: "appt-2", doctorId: "doctor-2", patientId: "patient-hijo", serviceId: "svc-1",
        inicio: new Date("2026-07-15T14:00:00.000Z"), fin: new Date("2026-07-15T14:30:00.000Z"), estado: "pendiente",
      },
    ];
    listUpcomingAppointmentsForPatientsMock.mockResolvedValue(appointments);

    const result = (await getToolHandler("get_my_appointments")!(undefined as never, CTX)) as Array<{
      doctorNombre: string;
      pacienteNombre: string;
    }>;
    expect(result[0]?.doctorNombre).toBe("Dr. Rodolfo Sánchez");
    expect(result[0]?.pacienteNombre).toBe("María");
    expect(result[1]?.pacienteNombre).toBe("Juan");
    expect(listUpcomingAppointmentsForPatientsMock).toHaveBeenCalledWith(["patient-1", "patient-hijo"]);
  });
});

describe("join_waitlist", () => {
  it("anota al titular con la preferencia indicada", async () => {
    addToWaitlistMock.mockResolvedValue(waitlistEntry({ diaSemana: 6, horaDesde: "15:00" }));

    const result = await getToolHandler("join_waitlist")!(
      { serviceId: "svc-1", diaSemana: 6, horaDesde: "15:00" } as never,
      CTX,
    );

    expect(result).toMatchObject({ waitlistEntryId: "wl-1" });
    expect(addToWaitlistMock).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: "patient-1", serviceId: "svc-1", diaSemana: 6, horaDesde: "15:00" }),
    );
  });

  it("con pacienteNombre ambiguo devuelve {error} y no anota", async () => {
    resolveOrCreateHouseholdPatientMock.mockResolvedValue({
      patient: { id: "patient-hijo-1", telefono: "+50688000001", nombre: "Juan", titular: false },
      ambiguous: true,
    });

    const result = await getToolHandler("join_waitlist")!(
      { serviceId: "svc-1", pacienteNombre: "Juan" } as never,
      CTX,
    );
    expect(result).toEqual({ error: expect.any(String) });
    expect(addToWaitlistMock).not.toHaveBeenCalled();
  });
});

describe("list_my_waitlist_entries", () => {
  it("incluye servicio, doctora y preferencia legibles", async () => {
    listWaitlistForPatientsMock.mockResolvedValue([
      waitlistEntry({ id: "wl-1", doctorId: "doctor-1", diaSemana: 6 }),
      waitlistEntry({ id: "wl-2" }),
    ]);
    listActiveServicesMock.mockResolvedValue([
      { id: "svc-1", nombre: "Limpieza dental", duracionMin: 30, bufferMin: 0, activo: true },
    ]);

    const result = (await getToolHandler("list_my_waitlist_entries")!(undefined as never, CTX)) as Array<{
      servicio: string;
      doctora: string;
      preferencia: string;
    }>;

    expect(result[0]).toMatchObject({ servicio: "Limpieza dental", doctora: "Dr. Rodolfo Sánchez" });
    expect(result[0]?.preferencia).toContain("sábado");
    expect(result[1]?.doctora).toBe("cualquiera");
  });

  it("incluye citaAgendadaId cuando el sistema ya agendó la entrada", async () => {
    listWaitlistForPatientsMock.mockResolvedValue([
      waitlistEntry({ id: "wl-1", estado: "agendada", appointmentGeneradaId: "appt-1" }),
    ]);
    listActiveServicesMock.mockResolvedValue([
      { id: "svc-1", nombre: "Limpieza dental", duracionMin: 30, bufferMin: 0, activo: true },
    ]);

    const result = (await getToolHandler("list_my_waitlist_entries")!(undefined as never, CTX)) as Array<{
      citaAgendadaId?: string;
    }>;

    expect(result[0]?.citaAgendadaId).toBe("appt-1");
  });
});

describe("leave_waitlist", () => {
  it("da de baja y devuelve ok", async () => {
    cancelWaitlistEntryMock.mockResolvedValue(undefined);
    const result = await getToolHandler("leave_waitlist")!({ waitlistEntryId: "wl-1" } as never, CTX);
    expect(result).toEqual({ ok: true });
    expect(cancelWaitlistEntryMock).toHaveBeenCalledWith("wl-1", CLINIC.id, ["patient-1"]);
  });

  it("convierte WaitlistEntryNotFoundError en {error} (protege contra IDOR)", async () => {
    cancelWaitlistEntryMock.mockRejectedValue(new WaitlistEntryNotFoundError());
    const result = await getToolHandler("leave_waitlist")!({ waitlistEntryId: "wl-ajena" } as never, CTX);
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("handoff_to_human", () => {
  it("devuelve ok y el motivo recibido", async () => {
    const result = await getToolHandler("handoff_to_human")!({ reason: "urgencia médica" } as never, CTX);
    expect(result).toEqual({ ok: true, reason: "urgencia médica" });
  });
});
