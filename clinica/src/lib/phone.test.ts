import { describe, expect, it } from "vitest";
import { looksLikePhone } from "./phone";

describe("looksLikePhone", () => {
  it("reconoce teléfonos con y sin separadores", () => {
    expect(looksLikePhone("88887777")).toBe(true);
    expect(looksLikePhone("8888 7777")).toBe(true);
    expect(looksLikePhone("+506 8888-7777")).toBe(true);
    expect(looksLikePhone("(506) 8888.7777")).toBe(true);
    expect(looksLikePhone(" 50688887777 ")).toBe(true);
  });

  it("acepta un número incompleto: tampoco es un nombre", () => {
    expect(looksLikePhone("8888")).toBe(true);
  });

  it("no reconoce nombres, ni siquiera con dígitos sueltos", () => {
    expect(looksLikePhone("Ana")).toBe(false);
    expect(looksLikePhone("José Pérez")).toBe(false);
    expect(looksLikePhone("Ana 2")).toBe(false);
    expect(looksLikePhone("Juan tel 88887777")).toBe(false);
  });

  it("no reconoce una búsqueda vacía", () => {
    expect(looksLikePhone("")).toBe(false);
    expect(looksLikePhone("   ")).toBe(false);
    expect(looksLikePhone("+")).toBe(false);
    expect(looksLikePhone("- ()")).toBe(false);
  });
});
