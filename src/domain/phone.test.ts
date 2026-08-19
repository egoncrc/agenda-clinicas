import { describe, expect, it } from "vitest";
import { toE164, toLocalPhone } from "./phone.js";

describe("toLocalPhone", () => {
  it("recorta +506 de un número E.164", () => {
    expect(toLocalPhone("+50688121373")).toBe("88121373");
  });

  it("recorta 506 sin +", () => {
    expect(toLocalPhone("50688121373")).toBe("88121373");
  });

  it("deja intacto un número ya local", () => {
    expect(toLocalPhone("88121373")).toBe("88121373");
  });

  it("limpia separadores", () => {
    expect(toLocalPhone("+506 8812-1373")).toBe("88121373");
  });
});

describe("toE164", () => {
  it("antepone +506 a un número local", () => {
    expect(toE164("88121373")).toBe("+50688121373");
  });

  it("no duplica el prefijo si ya viene incluido", () => {
    expect(toE164("50688121373")).toBe("+50688121373");
    expect(toE164("+50688121373")).toBe("+50688121373");
  });
});
