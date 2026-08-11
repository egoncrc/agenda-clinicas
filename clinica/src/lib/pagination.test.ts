import { describe, expect, it } from "vitest";
import { clampPage, pageRangeLabel, totalPages } from "./pagination";

describe("totalPages", () => {
  it("redondea hacia arriba", () => {
    expect(totalPages(25, 10)).toBe(3);
    expect(totalPages(20, 10)).toBe(2);
  });

  it("da 1 página aunque no haya resultados", () => {
    expect(totalPages(0, 10)).toBe(1);
  });
});

describe("clampPage", () => {
  it("deja pasar una página dentro de rango", () => {
    expect(clampPage(2, 3)).toBe(2);
  });

  it("no baja de 1", () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(-5, 3)).toBe(1);
  });

  it("no sube del total de páginas", () => {
    expect(clampPage(9, 3)).toBe(3);
  });
});

describe("pageRangeLabel", () => {
  it("calcula el rango de una página intermedia", () => {
    expect(pageRangeLabel(2, 10, 25)).toBe("Mostrando 11–20 de 25");
  });

  it("recorta el final en la última página", () => {
    expect(pageRangeLabel(3, 10, 25)).toBe("Mostrando 21–25 de 25");
  });

  it("reporta sin resultados cuando el total es 0", () => {
    expect(pageRangeLabel(1, 10, 0)).toBe("Sin resultados");
  });
});
