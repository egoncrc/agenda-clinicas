import { describe, expect, it } from "vitest";
import {
  buildPatientFilter,
  DEFAULT_SORT,
  EMPTY_COLUMN_FILTERS,
  nextSort,
  patientSort,
  type EstadoFilter,
  type PatientColumnFilters,
} from "./patientQuery";

function filtro(over: {
  estado?: EstadoFilter;
  search?: string;
  columns?: Partial<PatientColumnFilters>;
} = {}): Record<string, unknown>[] {
  const built = buildPatientFilter({
    clinicId: "clinic-1",
    estado: over.estado ?? "todos",
    search: over.search ?? "",
    columns: { ...EMPTY_COLUMN_FILTERS, ...over.columns },
  });
  return built._and as Record<string, unknown>[];
}

describe("buildPatientFilter", () => {
  it("sin filtros deja solo la clínica", () => {
    expect(filtro()).toEqual([{ clinic: { _eq: "clinic-1" } }]);
  });

  it("traduce las tres variantes de estado", () => {
    expect(filtro({ estado: "activos" })).toContainEqual({ activo: { _neq: false } });
    expect(filtro({ estado: "inactivos" })).toContainEqual({ activo: { _eq: false } });
    expect(filtro({ estado: "todos" })).toHaveLength(1);
  });

  it("el buscador global arma un _or con los cuatro campos de texto", () => {
    const conditions = filtro({ search: "ana" });
    const ors = conditions.filter((c) => "_or" in c);
    expect(ors).toHaveLength(1);
    expect(ors[0]).toEqual({
      _or: [
        { nombre: { _icontains: "ana" } },
        { telefono: { _contains: "ana" } },
        { identificacion: { _icontains: "ana" } },
        { correo: { _icontains: "ana" } },
      ],
    });
  });

  it("recorta espacios y descarta un filtro que quedó vacío", () => {
    expect(filtro({ columns: { nombre: "  ana  " } })).toContainEqual({ nombre: { _icontains: "ana" } });
    expect(filtro({ search: "   ", columns: { correo: "  " } })).toHaveLength(1);
  });

  it("usa _contains en teléfono e _icontains en el resto", () => {
    const conditions = filtro({
      columns: { telefono: "8888", identificacion: "1-1111", correo: "@mail" },
    });
    expect(conditions).toContainEqual({ telefono: { _contains: "8888" } });
    expect(conditions).toContainEqual({ identificacion: { _icontains: "1-1111" } });
    expect(conditions).toContainEqual({ correo: { _icontains: "@mail" } });
  });
});

describe("patientSort", () => {
  it("ordena por nombre ascendente por defecto", () => {
    expect(patientSort(DEFAULT_SORT)).toEqual(["nombre"]);
  });

  it("prefija con guion en descendente", () => {
    expect(patientSort({ key: "nombre", dir: "desc" })).toEqual(["-nombre"]);
  });

  it("estado se traduce a activo", () => {
    expect(patientSort({ key: "estado", dir: "asc" })).toEqual(["activo"]);
  });
});

describe("nextSort", () => {
  it("invierte la dirección en la misma columna", () => {
    expect(nextSort({ key: "nombre", dir: "asc" }, "nombre")).toEqual({ key: "nombre", dir: "desc" });
    expect(nextSort({ key: "nombre", dir: "desc" }, "nombre")).toEqual({ key: "nombre", dir: "asc" });
  });

  it("al cambiar de columna arranca ascendente", () => {
    expect(nextSort({ key: "nombre", dir: "desc" }, "correo")).toEqual({ key: "correo", dir: "asc" });
  });
});
