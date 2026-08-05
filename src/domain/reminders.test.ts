import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { duesReminders, type ReminderableAppointment } from "./reminders.js";

function dt(iso: string): Date {
  return DateTime.fromISO(iso, { zone: "America/Guayaquil" }).toJSDate();
}

function apt(overrides: Partial<ReminderableAppointment> = {}): ReminderableAppointment {
  return {
    inicio: dt("2026-07-13T10:00:00"),
    recordatorio24hEnviado: false,
    recordatorio2hEnviado: false,
    ...overrides,
  };
}

describe("duesReminders", () => {
  it("no dispara nada si falta mucho para la cita", () => {
    const now = dt("2026-07-10T10:00:00"); // 3 días antes
    expect(duesReminders(apt(), now)).toEqual([]);
  });

  it("dispara 24h al abrir esa ventana", () => {
    const now = dt("2026-07-12T10:00:00"); // exactamente 24h antes
    expect(duesReminders(apt(), now)).toEqual(["24h"]);
  });

  it("no repite el recordatorio de 24h si el flag ya está en true", () => {
    const now = dt("2026-07-12T10:00:00");
    expect(duesReminders(apt({ recordatorio24hEnviado: true }), now)).toEqual([]);
  });

  it("dispara 2h al abrir esa ventana, sin repetir el de 24h ya enviado", () => {
    const now = dt("2026-07-13T08:00:00"); // 2h antes
    expect(duesReminders(apt({ recordatorio24hEnviado: true }), now)).toEqual(["2h"]);
  });

  it("puede devolver ambos si el scheduler estuvo caído mucho tiempo", () => {
    const now = dt("2026-07-13T09:00:00"); // 1h antes, ningún flag enviado aún
    expect(duesReminders(apt(), now)).toEqual(["24h", "2h"]);
  });

  it("no dispara si la cita ya pasó", () => {
    const now = dt("2026-07-13T11:00:00"); // 1h después de iniciada
    expect(duesReminders(apt(), now)).toEqual([]);
  });
});
