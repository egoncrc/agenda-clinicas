import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { CLINIC_TIMEZONE, formatYmd, toYmd } from "./dateRanges";

describe("formatYmd", () => {
  it("muestra `yyyy-LL-dd` como `dd/mm/yyyy`", () => {
    expect(formatYmd("2026-08-10")).toBe("10/08/2026");
    expect(formatYmd("2026-12-01")).toBe("01/12/2026");
  });

  it("es el inverso de toYmd", () => {
    const dt = DateTime.fromObject({ year: 2026, month: 3, day: 9 }, { zone: CLINIC_TIMEZONE });
    expect(formatYmd(toYmd(dt))).toBe("09/03/2026");
  });

  it("devuelve la entrada tal cual si no es una fecha válida", () => {
    // Un `<input type="date">` vacío entrega "", y el título no debe decir "Invalid DateTime".
    expect(formatYmd("")).toBe("");
    expect(formatYmd("2026-13-45")).toBe("2026-13-45");
  });
});
