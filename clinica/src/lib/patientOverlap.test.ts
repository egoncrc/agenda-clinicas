import { describe, it, expect } from "vitest";
import { overlapsAnyAppointment } from "./patientOverlap";

function cita(horaInicio: string, horaFin: string) {
  return {
    inicio: `2026-04-06T${horaInicio}:00.000-06:00`,
    fin: `2026-04-06T${horaFin}:00.000-06:00`,
  };
}

function candidato(horaInicio: string, horaFin: string) {
  return {
    inicio: new Date(`2026-04-06T${horaInicio}:00.000-06:00`),
    fin: new Date(`2026-04-06T${horaFin}:00.000-06:00`),
  };
}

describe("overlapsAnyAppointment", () => {
  it("detecta el solape directo", () => {
    expect(overlapsAnyAppointment(candidato("09:30", "10:30"), [cita("09:00", "10:00")])).toBe(true);
  });

  it("detecta cuando el candidato contiene por completo a la cita existente", () => {
    expect(overlapsAnyAppointment(candidato("08:00", "12:00"), [cita("09:00", "10:00")])).toBe(true);
  });

  it("no marca tramos contiguos (semiabierto)", () => {
    expect(overlapsAnyAppointment(candidato("10:00", "11:00"), [cita("09:00", "10:00")])).toBe(false);
  });

  it("no marca cuando no hay ningún solape", () => {
    expect(overlapsAnyAppointment(candidato("11:00", "12:00"), [cita("09:00", "10:00")])).toBe(false);
  });

  it("ignora la lista vacía", () => {
    expect(overlapsAnyAppointment(candidato("09:00", "10:00"), [])).toBe(false);
  });
});
