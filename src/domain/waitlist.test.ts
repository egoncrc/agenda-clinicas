import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { matchesPreference, rankCandidates, specificityScore } from "./waitlist.js";
import type { WaitlistEntry } from "./types.js";

const TZ = "America/Guayaquil";

// Lunes 2026-07-13.
const MONDAY_9AM = DateTime.fromISO("2026-07-13T09:00", { zone: TZ });
const TUESDAY_9AM = DateTime.fromISO("2026-07-14T09:00", { zone: TZ });
const MONDAY_16PM = DateTime.fromISO("2026-07-13T16:00", { zone: TZ });

describe("matchesPreference", () => {
  it("sin preferencia, cualquier hueco coincide", () => {
    expect(matchesPreference({}, MONDAY_9AM)).toBe(true);
    expect(matchesPreference({}, TUESDAY_9AM)).toBe(true);
  });

  it("filtra por día de la semana", () => {
    expect(matchesPreference({ diaSemana: 1 }, MONDAY_9AM)).toBe(true);
    expect(matchesPreference({ diaSemana: 1 }, TUESDAY_9AM)).toBe(false);
  });

  it("filtra por hora mínima (horaDesde)", () => {
    expect(matchesPreference({ horaDesde: "15:00" }, MONDAY_16PM)).toBe(true);
    expect(matchesPreference({ horaDesde: "15:00" }, MONDAY_9AM)).toBe(false);
  });

  it("filtra por hora máxima (horaHasta)", () => {
    expect(matchesPreference({ horaHasta: "12:00" }, MONDAY_9AM)).toBe(true);
    expect(matchesPreference({ horaHasta: "12:00" }, MONDAY_16PM)).toBe(false);
  });

  it("combina día y hora: ambos deben cumplirse", () => {
    const pref = { diaSemana: 1 as const, horaDesde: "15:00" };
    expect(matchesPreference(pref, MONDAY_16PM)).toBe(true);
    expect(matchesPreference(pref, MONDAY_9AM)).toBe(false); // mismo día, hora fuera
    expect(matchesPreference({ ...pref, diaSemana: 2 as const }, MONDAY_16PM)).toBe(false); // hora ok, día no
  });
});

describe("specificityScore", () => {
  it("0 sin preferencia, 1 con una sola dimensión, 2 con día y hora", () => {
    expect(specificityScore({})).toBe(0);
    expect(specificityScore({ diaSemana: 6 })).toBe(1);
    expect(specificityScore({ horaDesde: "15:00" })).toBe(1);
    expect(specificityScore({ horaHasta: "12:00" })).toBe(1);
    expect(specificityScore({ diaSemana: 6, horaDesde: "15:00" })).toBe(2);
  });
});

function entry(overrides: Partial<WaitlistEntry> = {}): WaitlistEntry {
  return {
    id: "w1",
    patientId: "p1",
    serviceId: "s1",
    estado: "activa",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

describe("rankCandidates", () => {
  it("prioriza la preferencia más específica", () => {
    const generica = entry({ id: "generica", createdAt: new Date("2026-07-01T00:00:00Z") });
    const especifica = entry({
      id: "especifica",
      diaSemana: 6,
      horaDesde: "15:00",
      createdAt: new Date("2026-07-05T00:00:00Z"), // anotada después, igual gana por ser más específica
    });
    const ranked = rankCandidates([generica, especifica]);
    expect(ranked.map((e) => e.id)).toEqual(["especifica", "generica"]);
  });

  it("en empate de especificidad, gana quien se anotó primero (FIFO)", () => {
    const segundo = entry({ id: "segundo", diaSemana: 6, createdAt: new Date("2026-07-05T00:00:00Z") });
    const primero = entry({ id: "primero", diaSemana: 6, createdAt: new Date("2026-07-01T00:00:00Z") });
    const ranked = rankCandidates([segundo, primero]);
    expect(ranked.map((e) => e.id)).toEqual(["primero", "segundo"]);
  });
});
