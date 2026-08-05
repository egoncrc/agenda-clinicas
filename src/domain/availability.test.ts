import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { computeAvailableSlots, hasOverlap, overlapsTimeOff } from "./availability.js";
import type { Appointment, Service, TimeOff, WorkingHours } from "./types.js";

const TZ = "America/Guayaquil";

const limpieza: Service = {
  id: "svc-limpieza",
  nombre: "Limpieza dental",
  duracionMin: 30,
  bufferMin: 0,
  activo: true,
  specialtyId: "sp-odon",
};

const endodoncia: Service = {
  id: "svc-endodoncia",
  nombre: "Tratamiento de nervio",
  duracionMin: 60,
  bufferMin: 0,
  activo: true,
  specialtyId: "sp-odon",
};

/** Lunes 08:00–12:00 para el doctora d1. */
function lunes0812(doctorId = "d1"): WorkingHours[] {
  return [{ doctorId, diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }];
}

function dt(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: TZ });
}

// Lunes 2026-07-13 en la zona de la clínica.
const MONDAY = "2026-07-13";
const NOW = dt("2026-07-06T00:00:00"); // una semana antes: todo es futuro

describe("computeAvailableSlots", () => {
  it("genera huecos de 30 min en pasos de 30 para una jornada de 4h", () => {
    const slots = computeAvailableSlots({
      service: limpieza,
      workingHours: lunes0812(),
      timeOff: [],
      appointments: [],
      from: dt(`${MONDAY}T00:00`),
      to: dt(`${MONDAY}T23:59`),
      slotStepMin: 30,
      now: NOW,
      timezone: TZ,
    });
    // 08:00..11:30 inicio, cada 30 min => 8 huecos (último 11:30-12:00)
    expect(slots).toHaveLength(8);
    expect(DateTime.fromJSDate(slots[0]!.inicio, { zone: TZ }).toFormat("HH:mm")).toBe("08:00");
    expect(DateTime.fromJSDate(slots.at(-1)!.inicio, { zone: TZ }).toFormat("HH:mm")).toBe("11:30");
  });

  it("respeta la duración del servicio: endodoncia (60') deja menos huecos", () => {
    const slots = computeAvailableSlots({
      service: endodoncia,
      workingHours: lunes0812(),
      timeOff: [],
      appointments: [],
      from: dt(`${MONDAY}T00:00`),
      to: dt(`${MONDAY}T23:59`),
      slotStepMin: 60,
      now: NOW,
      timezone: TZ,
    });
    // 08,09,10,11 => 4 huecos de 1h
    expect(slots).toHaveLength(4);
    expect(DateTime.fromJSDate(slots.at(-1)!.fin, { zone: TZ }).toFormat("HH:mm")).toBe("12:00");
  });

  it("no ofrece un hueco que se solapa con una cita existente", () => {
    const cita: Appointment = {
      id: "a1",
      doctorId: "d1",
      patientId: "p1",
      serviceId: "svc-limpieza",
      inicio: dt(`${MONDAY}T09:00`).toJSDate(),
      fin: dt(`${MONDAY}T09:30`).toJSDate(),
      estado: "confirmada",
    };
    const slots = computeAvailableSlots({
      service: limpieza,
      workingHours: lunes0812(),
      timeOff: [],
      appointments: [cita],
      from: dt(`${MONDAY}T00:00`),
      to: dt(`${MONDAY}T23:59`),
      slotStepMin: 30,
      now: NOW,
      timezone: TZ,
    });
    const horas = slots.map((s) =>
      DateTime.fromJSDate(s.inicio, { zone: TZ }).toFormat("HH:mm"),
    );
    expect(horas).not.toContain("09:00");
    expect(horas).toContain("08:30");
    expect(horas).toContain("09:30");
  });

  it("aplica el buffer: con 15' de buffer, una cita 09:00-09:30 bloquea 08:30 y 09:30", () => {
    const svc: Service = { ...limpieza, bufferMin: 15 };
    const cita: Appointment = {
      id: "a1",
      doctorId: "d1",
      patientId: "p1",
      serviceId: "svc-limpieza",
      inicio: dt(`${MONDAY}T09:00`).toJSDate(),
      fin: dt(`${MONDAY}T09:30`).toJSDate(),
      estado: "confirmada",
    };
    const slots = computeAvailableSlots({
      service: svc,
      workingHours: lunes0812(),
      timeOff: [],
      appointments: [cita],
      from: dt(`${MONDAY}T00:00`),
      to: dt(`${MONDAY}T23:59`),
      slotStepMin: 30,
      now: NOW,
      timezone: TZ,
    });
    const horas = slots.map((s) =>
      DateTime.fromJSDate(s.inicio, { zone: TZ }).toFormat("HH:mm"),
    );
    // 08:30-09:00 abuta con el buffer previo (08:45) => bloqueado
    expect(horas).not.toContain("08:30");
    // 09:30-10:00 abuta con el buffer posterior (09:45) => bloqueado
    expect(horas).not.toContain("09:30");
    expect(horas).toContain("08:00");
    expect(horas).toContain("10:00");
  });

  it("una cita cancelada libera el hueco", () => {
    const cita: Appointment = {
      id: "a1",
      doctorId: "d1",
      patientId: "p1",
      serviceId: "svc-limpieza",
      inicio: dt(`${MONDAY}T09:00`).toJSDate(),
      fin: dt(`${MONDAY}T09:30`).toJSDate(),
      estado: "cancelada",
    };
    const slots = computeAvailableSlots({
      service: limpieza,
      workingHours: lunes0812(),
      timeOff: [],
      appointments: [cita],
      from: dt(`${MONDAY}T00:00`),
      to: dt(`${MONDAY}T23:59`),
      slotStepMin: 30,
      now: NOW,
      timezone: TZ,
    });
    const horas = slots.map((s) =>
      DateTime.fromJSDate(s.inicio, { zone: TZ }).toFormat("HH:mm"),
    );
    expect(horas).toContain("09:00");
  });

  it("no ofrece huecos dentro de una ausencia (time_off)", () => {
    const off: TimeOff = {
      doctorId: "d1",
      inicio: dt(`${MONDAY}T08:00`).toJSDate(),
      fin: dt(`${MONDAY}T10:00`).toJSDate(),
    };
    const slots = computeAvailableSlots({
      service: limpieza,
      workingHours: lunes0812(),
      timeOff: [off],
      appointments: [],
      from: dt(`${MONDAY}T00:00`),
      to: dt(`${MONDAY}T23:59`),
      slotStepMin: 30,
      now: NOW,
      timezone: TZ,
    });
    const horas = slots.map((s) =>
      DateTime.fromJSDate(s.inicio, { zone: TZ }).toFormat("HH:mm"),
    );
    expect(horas).not.toContain("08:00");
    expect(horas).not.toContain("09:30");
    expect(horas).toContain("10:00");
  });

  it("no ofrece huecos en el pasado", () => {
    const nowMidMorning = dt(`${MONDAY}T09:15`);
    const slots = computeAvailableSlots({
      service: limpieza,
      workingHours: lunes0812(),
      timeOff: [],
      appointments: [],
      from: dt(`${MONDAY}T00:00`),
      to: dt(`${MONDAY}T23:59`),
      slotStepMin: 30,
      now: nowMidMorning,
      timezone: TZ,
    });
    const horas = slots.map((s) =>
      DateTime.fromJSDate(s.inicio, { zone: TZ }).toFormat("HH:mm"),
    );
    expect(horas).not.toContain("08:00");
    expect(horas).not.toContain("09:00");
    expect(horas).toContain("09:30");
  });
});

describe("hasOverlap", () => {
  const existentes: Appointment[] = [
    {
      id: "a1",
      doctorId: "d1",
      patientId: "p1",
      serviceId: "svc-limpieza",
      inicio: dt(`${MONDAY}T09:00`).toJSDate(),
      fin: dt(`${MONDAY}T09:30`).toJSDate(),
      estado: "confirmada",
    },
  ];

  it("detecta solapamiento directo", () => {
    const res = hasOverlap(
      { inicio: dt(`${MONDAY}T09:15`).toJSDate(), fin: dt(`${MONDAY}T09:45`).toJSDate() },
      existentes,
      0,
      TZ,
    );
    expect(res).toBe(true);
  });

  it("permite una cita contigua sin buffer", () => {
    const res = hasOverlap(
      { inicio: dt(`${MONDAY}T09:30`).toJSDate(), fin: dt(`${MONDAY}T10:00`).toJSDate() },
      existentes,
      0,
      TZ,
    );
    expect(res).toBe(false);
  });

  it("con buffer, una cita contigua sí solapa", () => {
    const res = hasOverlap(
      { inicio: dt(`${MONDAY}T09:30`).toJSDate(), fin: dt(`${MONDAY}T10:00`).toJSDate() },
      existentes,
      15,
      TZ,
    );
    expect(res).toBe(true);
  });
});

describe("overlapsTimeOff", () => {
  const ausencias: TimeOff[] = [
    {
      doctorId: "d1",
      inicio: dt(`${MONDAY}T13:00`).toJSDate(),
      fin: dt(`${MONDAY}T18:00`).toJSDate(),
    },
  ];

  it("detecta una cita propuesta dentro de la ausencia", () => {
    const res = overlapsTimeOff(
      { inicio: dt(`${MONDAY}T14:00`).toJSDate(), fin: dt(`${MONDAY}T15:00`).toJSDate() },
      ausencias,
      TZ,
    );
    expect(res).toBe(true);
  });

  it("detecta una cita propuesta que solo se solapa parcialmente con la ausencia", () => {
    const res = overlapsTimeOff(
      { inicio: dt(`${MONDAY}T12:30`).toJSDate(), fin: dt(`${MONDAY}T13:30`).toJSDate() },
      ausencias,
      TZ,
    );
    expect(res).toBe(true);
  });

  it("permite una cita fuera de la ausencia", () => {
    const res = overlapsTimeOff(
      { inicio: dt(`${MONDAY}T09:00`).toJSDate(), fin: dt(`${MONDAY}T09:30`).toJSDate() },
      ausencias,
      TZ,
    );
    expect(res).toBe(false);
  });

  it("permite una cita contigua justo al terminar la ausencia", () => {
    const res = overlapsTimeOff(
      { inicio: dt(`${MONDAY}T18:00`).toJSDate(), fin: dt(`${MONDAY}T18:30`).toJSDate() },
      ausencias,
      TZ,
    );
    expect(res).toBe(false);
  });
});
