import { describe, expect, it } from "vitest";
import {
  IDLE_LIMIT_MS,
  WARNING_LEAD_MS,
  getIdlePhase,
  isClaimFresh,
  resolveSeedActivity,
  secondsUntilLogout,
} from "@/lib/idleTimeout";

const WARNING_START = IDLE_LIMIT_MS - WARNING_LEAD_MS;

describe("getIdlePhase", () => {
  it("está activo antes del minuto 59", () => {
    expect(getIdlePhase(0, WARNING_START - 1)).toBe("active");
  });

  it("pasa a warning justo al entrar al último minuto", () => {
    expect(getIdlePhase(0, WARNING_START)).toBe("warning");
  });

  it("sigue en warning justo antes de la hora", () => {
    expect(getIdlePhase(0, IDLE_LIMIT_MS - 1)).toBe("warning");
  });

  it("expira justo al cumplir la hora", () => {
    expect(getIdlePhase(0, IDLE_LIMIT_MS)).toBe("expired");
  });

  it("sigue expirado bastante después", () => {
    expect(getIdlePhase(0, IDLE_LIMIT_MS + 5000)).toBe("expired");
  });
});

describe("secondsUntilLogout", () => {
  it("da los segundos exactos al entrar en warning", () => {
    expect(secondsUntilLogout(0, WARNING_START)).toBe(60);
  });

  it("nunca da negativo pasada la hora", () => {
    expect(secondsUntilLogout(0, IDLE_LIMIT_MS + 10_000)).toBe(0);
  });
});

describe("isClaimFresh", () => {
  it("es fresco dentro del TTL", () => {
    expect(isClaimFresh(1000, 1000 + 10_000)).toBe(true);
  });

  it("deja de ser fresco pasado el TTL", () => {
    expect(isClaimFresh(1000, 1000 + 31_000)).toBe(false);
  });

  it("null nunca es fresco", () => {
    expect(isClaimFresh(null, 1000)).toBe(false);
  });
});

describe("resolveSeedActivity", () => {
  it("arranca en now si no hay valor guardado", () => {
    expect(resolveSeedActivity(null, 5000)).toBe(5000);
  });

  it("conserva el valor guardado si sigue dentro de la hora", () => {
    expect(resolveSeedActivity(1000, 1000 + 100)).toBe(1000);
  });

  it("descarta el valor guardado si ya es de una sesión vieja", () => {
    expect(resolveSeedActivity(0, IDLE_LIMIT_MS + 1)).toBe(IDLE_LIMIT_MS + 1);
  });
});
