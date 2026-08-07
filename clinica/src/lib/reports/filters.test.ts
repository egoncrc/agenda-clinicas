import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { CLINIC_TIMEZONE } from "@/lib/dateRanges";
import { shiftRange } from "./filters";
import type { DatePreset, ReportFilters } from "./types";

/** Filtros mínimos: `shiftRange` solo mira `preset`/`desde`/`hasta`. */
function filtros(preset: DatePreset, desde: string, hasta: string): ReportFilters {
  return {
    preset,
    desde,
    hasta,
    clinicId: null,
    doctorId: null,
    specialtyId: null,
    serviceId: null,
    groupBy: "especialidad",
  };
}

const ymd = (iso: string) => DateTime.fromISO(iso, { zone: CLINIC_TIMEZONE }).toFormat("yyyy-LL-dd");

describe("shiftRange", () => {
  it("mueve un día hacia atrás y hacia adelante", () => {
    const f = filtros("hoy", "2026-08-07T00:00:00-06:00", "2026-08-07T23:59:59.999-06:00");
    expect(ymd(shiftRange(f, -1).desde)).toBe("2026-08-06");
    expect(ymd(shiftRange(f, 1).desde)).toBe("2026-08-08");
  });

  it("mueve una semana ISO completa, de lunes a domingo", () => {
    const f = filtros("semana", "2026-08-03T00:00:00-06:00", "2026-08-09T23:59:59.999-06:00");
    const anterior = shiftRange(f, -1);
    expect(ymd(anterior.desde)).toBe("2026-07-27");
    expect(ymd(anterior.hasta)).toBe("2026-08-02");
  });

  it("mueve un mes calendario y respeta el largo del mes destino", () => {
    const f = filtros("mes", "2026-03-01T00:00:00-06:00", "2026-03-31T23:59:59.999-06:00");
    const anterior = shiftRange(f, -1);
    expect(ymd(anterior.desde)).toBe("2026-02-01");
    expect(ymd(anterior.hasta)).toBe("2026-02-28");
  });

  it("encadena saltos: el ancla es el rango actual, no hoy", () => {
    let f = filtros("mes", "2026-08-01T00:00:00-06:00", "2026-08-31T23:59:59.999-06:00");
    for (let i = 0; i < 3; i++) f = { ...f, ...shiftRange(f, -1) };
    expect(ymd(f.desde)).toBe("2026-05-01");
  });

  it("deja el rango personalizado intacto: no tiene unidad que desplazar", () => {
    const f = filtros("personalizado", "2026-08-01T00:00:00-06:00", "2026-08-19T23:59:59.999-06:00");
    expect(shiftRange(f, -1)).toEqual({ desde: f.desde, hasta: f.hasta });
  });
});
