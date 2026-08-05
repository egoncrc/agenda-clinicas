import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PatientRow } from "../directus.js";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("../directus.js", () => ({ directus: { request: requestMock } }));

const {
  findOrCreatePatient,
  findTitularByPhone,
  listPatientsByPhone,
  createDependentPatient,
  resolveOrCreateHouseholdPatient,
} = await import("./patients.js");

const CLINIC_ID = "clinic-1";

const TITULAR: PatientRow = { id: "patient-1", telefono: "+50688000001", nombre: "María", titular: true, clinic: CLINIC_ID };

beforeEach(() => {
  requestMock.mockReset();
});

describe("findOrCreatePatient", () => {
  it("devuelve el titular existente del número sin crear otro", async () => {
    requestMock.mockResolvedValueOnce([TITULAR]); // readItems: hay titular

    const result = await findOrCreatePatient("+50688000001", CLINIC_ID);
    expect(result).toEqual(TITULAR);
    expect(requestMock).toHaveBeenCalledTimes(1); // no llega al createItem
  });

  it("crea al titular si el número aún no tiene uno", async () => {
    requestMock
      .mockResolvedValueOnce([]) // readItems: sin titular
      .mockResolvedValueOnce({ id: "patient-nuevo", telefono: "+50688000002", titular: true, clinic: CLINIC_ID }); // createItem

    const result = await findOrCreatePatient("+50688000002", CLINIC_ID);
    expect(result).toMatchObject({ id: "patient-nuevo", titular: true });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});

describe("findTitularByPhone", () => {
  it("devuelve el titular si existe", async () => {
    requestMock.mockResolvedValueOnce([TITULAR]);

    const result = await findTitularByPhone("+50688000001", CLINIC_ID);
    expect(result).toEqual(TITULAR);
  });

  it("devuelve null sin crear nada si el número no tiene titular", async () => {
    requestMock.mockResolvedValueOnce([]);

    const result = await findTitularByPhone("+50688000002", CLINIC_ID);
    expect(result).toBeNull();
    expect(requestMock).toHaveBeenCalledTimes(1); // no llega a ningún createItem
  });
});

describe("listPatientsByPhone", () => {
  it("devuelve todos los pacientes del número (titular + familiares)", async () => {
    const grupo: PatientRow[] = [
      TITULAR,
      { id: "patient-hijo", telefono: "+50688000001", nombre: "Juan", titular: false, clinic: CLINIC_ID },
    ];
    requestMock.mockResolvedValueOnce(grupo);

    const result = await listPatientsByPhone("+50688000001", CLINIC_ID);
    expect(result).toEqual(grupo);
  });
});

describe("createDependentPatient", () => {
  it("crea un familiar no titular bajo el número dado", async () => {
    const creado: PatientRow = { id: "patient-hijo", telefono: "+50688000001", nombre: "Juan", titular: false, clinic: CLINIC_ID };
    requestMock.mockResolvedValueOnce(creado);

    const result = await createDependentPatient("+50688000001", "Juan", CLINIC_ID);
    expect(result).toEqual(creado);
    expect(result.titular).toBe(false);
  });
});

describe("resolveOrCreateHouseholdPatient", () => {
  it("reutiliza al paciente existente con ese nombre (sin distinguir mayúsculas), sin crear otro", async () => {
    const hijo: PatientRow = { id: "patient-hijo", telefono: "+50688000001", nombre: "Juan", titular: false, clinic: CLINIC_ID };
    requestMock.mockResolvedValueOnce([TITULAR, hijo]); // listPatientsByPhone

    const result = await resolveOrCreateHouseholdPatient("+50688000001", "juan", CLINIC_ID);
    expect(result).toEqual({ patient: hijo, ambiguous: false });
    expect(requestMock).toHaveBeenCalledTimes(1); // no llega al createItem
  });

  it("crea un familiar nuevo si nadie con ese nombre existe bajo el número", async () => {
    const creado: PatientRow = { id: "patient-nuevo", telefono: "+50688000001", nombre: "Pedro", titular: false, clinic: CLINIC_ID };
    requestMock
      .mockResolvedValueOnce([TITULAR]) // listPatientsByPhone: nadie se llama Pedro
      .mockResolvedValueOnce(creado); // createItem

    const result = await resolveOrCreateHouseholdPatient("+50688000001", "Pedro", CLINIC_ID);
    expect(result).toEqual({ patient: creado, ambiguous: false });
  });

  it("marca ambiguous si hay más de una persona con ese nombre bajo el mismo número", async () => {
    const homonimo1: PatientRow = { id: "patient-a", telefono: "+50688000001", nombre: "Juan", titular: false, clinic: CLINIC_ID };
    const homonimo2: PatientRow = { id: "patient-b", telefono: "+50688000001", nombre: "Juan", titular: false, clinic: CLINIC_ID };
    requestMock.mockResolvedValueOnce([TITULAR, homonimo1, homonimo2]);

    const result = await resolveOrCreateHouseholdPatient("+50688000001", "Juan", CLINIC_ID);
    expect(result.ambiguous).toBe(true);
  });
});
