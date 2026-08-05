import { describe, it, expect } from "vitest";
import { computePatientMix } from "./patientMix";

const TZ = "America/Costa_Rica";

describe("computePatientMix", () => {
  it("cuenta como nuevo al paciente cuya primera cita cae en ese mes", () => {
    const r = computePatientMix({
      timezone: TZ,
      meses: ["2026-01"],
      primeraCita: new Map([["p1", "2026-01-10T09:00:00-06:00"]]),
      citas: [{ patient: "p1", inicio: "2026-01-10T09:00:00-06:00" }],
    });
    expect(r).toEqual([{ mes: "2026-01", nuevos: 1, recurrentes: 0 }]);
  });

  it("cuenta como recurrente al paciente cuya primera cita fue antes", () => {
    const r = computePatientMix({
      timezone: TZ,
      meses: ["2026-02"],
      primeraCita: new Map([["p1", "2025-11-03T09:00:00-06:00"]]),
      citas: [{ patient: "p1", inicio: "2026-02-10T09:00:00-06:00" }],
    });
    expect(r).toEqual([{ mes: "2026-02", nuevos: 0, recurrentes: 1 }]);
  });

  it("cuenta a la persona una sola vez aunque tenga varias citas en el mes", () => {
    const r = computePatientMix({
      timezone: TZ,
      meses: ["2026-01"],
      primeraCita: new Map([["p1", "2026-01-05T09:00:00-06:00"]]),
      citas: [
        { patient: "p1", inicio: "2026-01-05T09:00:00-06:00" },
        { patient: "p1", inicio: "2026-01-20T09:00:00-06:00" },
        { patient: "p1", inicio: "2026-01-28T09:00:00-06:00" },
      ],
    });
    expect(r).toEqual([{ mes: "2026-01", nuevos: 1, recurrentes: 0 }]);
  });

  it("el mismo paciente es nuevo en su primer mes y recurrente en el siguiente", () => {
    const r = computePatientMix({
      timezone: TZ,
      meses: ["2026-01", "2026-02"],
      primeraCita: new Map([["p1", "2026-01-05T09:00:00-06:00"]]),
      citas: [
        { patient: "p1", inicio: "2026-01-05T09:00:00-06:00" },
        { patient: "p1", inicio: "2026-02-05T09:00:00-06:00" },
      ],
    });
    expect(r).toEqual([
      { mes: "2026-01", nuevos: 1, recurrentes: 0 },
      { mes: "2026-02", nuevos: 0, recurrentes: 1 },
    ]);
  });

  it("devuelve el mes en cero si no hubo citas", () => {
    const r = computePatientMix({
      timezone: TZ,
      meses: ["2026-03"],
      primeraCita: new Map(),
      citas: [],
    });
    expect(r).toEqual([{ mes: "2026-03", nuevos: 0, recurrentes: 0 }]);
  });

  it("cuenta como recurrente al paciente sin primera cita conocida (no infla la captación)", () => {
    const r = computePatientMix({
      timezone: TZ,
      meses: ["2026-01"],
      primeraCita: new Map(),
      citas: [{ patient: "p1", inicio: "2026-01-10T09:00:00-06:00" }],
    });
    expect(r).toEqual([{ mes: "2026-01", nuevos: 0, recurrentes: 1 }]);
  });

  it("asigna el mes según la zona de la clínica, no según UTC", () => {
    // 2026-02-01T02:00Z son todavía las 20:00 del 31 de enero en Costa Rica.
    const r = computePatientMix({
      timezone: TZ,
      meses: ["2026-01", "2026-02"],
      primeraCita: new Map([["p1", "2026-02-01T02:00:00Z"]]),
      citas: [{ patient: "p1", inicio: "2026-02-01T02:00:00Z" }],
    });
    expect(r).toEqual([
      { mes: "2026-01", nuevos: 1, recurrentes: 0 },
      { mes: "2026-02", nuevos: 0, recurrentes: 0 },
    ]);
  });

  it("separa a los pacientes entre nuevos y recurrentes en el mismo mes", () => {
    const r = computePatientMix({
      timezone: TZ,
      meses: ["2026-01"],
      primeraCita: new Map([
        ["p1", "2026-01-10T09:00:00-06:00"],
        ["p2", "2025-06-10T09:00:00-06:00"],
        ["p3", "2026-01-22T09:00:00-06:00"],
      ]),
      citas: [
        { patient: "p1", inicio: "2026-01-10T09:00:00-06:00" },
        { patient: "p2", inicio: "2026-01-15T09:00:00-06:00" },
        { patient: "p3", inicio: "2026-01-22T09:00:00-06:00" },
      ],
    });
    expect(r).toEqual([{ mes: "2026-01", nuevos: 2, recurrentes: 1 }]);
  });
});
