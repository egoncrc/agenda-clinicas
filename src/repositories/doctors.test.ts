import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("../directus.js", () => ({ directus: { request: requestMock } }));

// Captura el objeto de query que se le pasa a readItems, para inspeccionar el filtro.
vi.mock("@directus/sdk", () => ({
  readItems: (collection: string, query: unknown) => ({ collection, query }),
}));

const { listActiveDoctors, getDoctor } = await import("./doctors.js");
const { listActiveSpecialties } = await import("./specialties.js");
const { listActiveServices } = await import("./services.js");

beforeEach(() => requestMock.mockReset());

/**
 * Un médico puede trabajar en varias clínicas: la identidad vive en `doctors` y
 * el vínculo (con su especialidad en esa sede) en `clinics_doctors`. De ahí que
 * cada lectura sean dos consultas: primero los vínculos de la clínica, después
 * los médicos de esos vínculos.
 */
describe("listActiveDoctors", () => {
  it("filtra los vínculos por clínica y activo, sin especialidad si no se indica", async () => {
    requestMock.mockResolvedValue([]);
    await listActiveDoctors("clinic-1");
    const { collection, query } = requestMock.mock.calls[0]![0] as {
      collection: string;
      query: { filter: Record<string, unknown> };
    };
    expect(collection).toBe("clinics_doctors");
    expect(query.filter).toEqual({ clinics_id: { _eq: "clinic-1" }, activo: { _eq: true } });
  });

  it("añade el filtro de especialidad cuando se pasa specialtyId", async () => {
    requestMock.mockResolvedValue([]);
    await listActiveDoctors("clinic-1", "sp-odon");
    const { query } = requestMock.mock.calls[0]![0] as { query: { filter: Record<string, unknown> } };
    expect(query.filter).toEqual({
      clinics_id: { _eq: "clinic-1" },
      activo: { _eq: true },
      specialty: { _eq: "sp-odon" },
    });
  });

  it("no consulta médicos si la clínica no tiene ningún vínculo", async () => {
    requestMock.mockResolvedValue([]);
    expect(await listActiveDoctors("clinic-1")).toEqual([]);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("mapea a Doctor con la especialidad del vínculo, no la del médico", async () => {
    requestMock
      .mockResolvedValueOnce([{ id: "cd1", clinics_id: "clinic-1", doctors_id: "d1", specialty: "sp-orto", activo: true }])
      .mockResolvedValueOnce([{ id: "d1", nombre: "Dr. Uno", activo: true }]);
    const doctors = await listActiveDoctors("clinic-1");
    expect(doctors).toEqual([{ id: "d1", nombre: "Dr. Uno", activo: true, specialtyId: "sp-orto" }]);
  });

  it("el mismo médico sale con la especialidad de cada clínica", async () => {
    requestMock
      .mockResolvedValueOnce([{ id: "cd2", clinics_id: "clinic-2", doctors_id: "d1", specialty: "sp-odon", activo: true }])
      .mockResolvedValueOnce([{ id: "d1", nombre: "Dr. Uno", activo: true }]);
    const doctors = await listActiveDoctors("clinic-2");
    expect(doctors[0]!.specialtyId).toBe("sp-odon");
  });
});

describe("getDoctor", () => {
  it("lanza si el médico no trabaja en la clínica", async () => {
    requestMock.mockResolvedValue([]);
    await expect(getDoctor("d1", "clinic-1")).rejects.toThrow(/no encontrado/i);
  });

  it("resuelve por el vínculo, sin exigir que esté activo (citas ya creadas)", async () => {
    requestMock
      .mockResolvedValueOnce([{ id: "cd1", clinics_id: "clinic-1", doctors_id: "d1", specialty: "sp-odon", activo: false }])
      .mockResolvedValueOnce([{ id: "d1", nombre: "Dr. Uno", activo: true }]);
    expect(await getDoctor("d1", "clinic-1")).toEqual({
      id: "d1",
      nombre: "Dr. Uno",
      activo: true,
      specialtyId: "sp-odon",
    });
  });
});

describe("listActiveServices", () => {
  it("añade el filtro de especialidad cuando se pasa specialtyId", async () => {
    requestMock.mockResolvedValue([]);
    await listActiveServices("clinic-1", "sp-odon");
    const { query } = requestMock.mock.calls[0]![0] as { query: { filter: Record<string, unknown> } };
    expect(query.filter).toEqual({
      activo: { _eq: true },
      clinic: { _eq: "clinic-1" },
      specialty: { _eq: "sp-odon" },
    });
  });
});

describe("listActiveSpecialties", () => {
  it("filtra por clínica y activo, y mapea a Specialty", async () => {
    requestMock.mockResolvedValue([{ id: "sp-odon", nombre: "Odontología", activo: true, clinic: "clinic-1" }]);
    const specialties = await listActiveSpecialties("clinic-1");
    const { query } = requestMock.mock.calls[0]![0] as { query: { filter: Record<string, unknown> } };
    expect(query.filter).toEqual({ activo: { _eq: true }, clinic: { _eq: "clinic-1" } });
    expect(specialties).toEqual([{ id: "sp-odon", nombre: "Odontología", activo: true }]);
  });
});
