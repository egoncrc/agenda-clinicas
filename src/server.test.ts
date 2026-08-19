import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClinicRow, PatientRow } from "./directus.js";

const SECRET = "test-webhook-secret";

const INTERNAL_SECRET = "test-internal-secret";

vi.mock("./config.js", () => ({
  config: {
    DIRECTUS_URL: "https://example.invalid/",
    DIRECTUS_TOKEN: "token",
    YCLOUD_API_KEY: "ycloud-key",
    YCLOUD_WEBHOOK_SECRET: SECRET,
    WHATSAPP_FROM: "+50600000000",
    ANTHROPIC_API_KEY: "anthropic-key",
    ANTHROPIC_MODEL: "claude-sonnet-5",
    PORT: 0,
    CLINIC_TIMEZONE: "America/Guayaquil",
    SLOT_STEP_MINUTES: 15,
    INTERNAL_API_SECRET: INTERNAL_SECRET,
    WAITLIST_ENABLED: true,
  },
}));

const findOrCreatePatientMock = vi.fn();
const listPatientsByPhoneMock = vi.fn();
const logMessageMock = vi.fn();
const getRecentMessagesMock = vi.fn();
const runAgentTurnMock = vi.fn();
const sendTextMock = vi.fn();
const runWaitlistMatchingJobMock = vi.fn();
const getClinicByWhatsappNumberMock = vi.fn();
const getDefaultClinicMock = vi.fn();
const listActiveClinicsMock = vi.fn();

vi.mock("./repositories/patients.js", () => ({
  findOrCreatePatient: findOrCreatePatientMock,
  listPatientsByPhone: listPatientsByPhoneMock,
}));
vi.mock("./repositories/messages.js", () => ({
  logMessage: logMessageMock,
  getRecentMessages: getRecentMessagesMock,
}));
vi.mock("./ai/agent.js", () => ({ runAgentTurn: runAgentTurnMock }));
vi.mock("./whatsapp/ycloud.js", () => ({ sendText: sendTextMock }));
vi.mock("./repositories/waitlist.js", () => ({ runWaitlistMatchingJob: runWaitlistMatchingJobMock }));
vi.mock("./repositories/clinics.js", () => ({
  getClinicByWhatsappNumber: getClinicByWhatsappNumberMock,
  getDefaultClinic: getDefaultClinicMock,
  listActiveClinics: listActiveClinicsMock,
}));

const { app, processInboundEvent } = await import("./server.js");

const CLINIC: ClinicRow = { id: "clinic-1", nombre: "Clínica Principal", activo: true };

function sign(timestamp: string, body: string): string {
  const hex = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},s=${hex}`;
}

const PATIENT: PatientRow = { id: "patient-1", telefono: "+50688000001", titular: true, clinic: CLINIC.id };

beforeEach(() => {
  findOrCreatePatientMock.mockReset().mockResolvedValue(PATIENT);
  listPatientsByPhoneMock.mockReset().mockResolvedValue([PATIENT]);
  logMessageMock.mockReset().mockResolvedValue(undefined);
  getRecentMessagesMock.mockReset().mockResolvedValue([]);
  runAgentTurnMock.mockReset().mockResolvedValue("Respuesta del agente");
  sendTextMock.mockReset().mockResolvedValue(undefined);
  runWaitlistMatchingJobMock.mockReset().mockResolvedValue({ agendadas: 0 });
  getClinicByWhatsappNumberMock.mockReset().mockResolvedValue(undefined);
  getDefaultClinicMock.mockReset().mockResolvedValue(CLINIC);
  listActiveClinicsMock.mockReset().mockResolvedValue([CLINIC]);
});

describe("POST /webhook/ycloud (HTTP)", () => {
  let server: import("node:http").Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rechaza con 401 si la firma es inválida", async () => {
    const res = await fetch(`${baseUrl}/webhook/ycloud`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "YCloud-Signature": "t=1,s=bad" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("rechaza con 401 si falta la firma", async () => {
    const res = await fetch(`${baseUrl}/webhook/ycloud`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("acepta con 200 cuando la firma es válida", async () => {
    const body = "{}";
    const freshTimestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${baseUrl}/webhook/ycloud`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "YCloud-Signature": sign(freshTimestamp, body) },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });
});

describe("POST /internal/waitlist/run (HTTP)", () => {
  let server: import("node:http").Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rechaza con 401 sin el secreto correcto", async () => {
    const res = await fetch(`${baseUrl}/internal/waitlist/run`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(runWaitlistMatchingJobMock).not.toHaveBeenCalled();
  });

  it("rechaza con 401 con un secreto incorrecto", async () => {
    const res = await fetch(`${baseUrl}/internal/waitlist/run`, {
      method: "POST",
      headers: { "X-Internal-Secret": "secreto-equivocado" },
    });
    expect(res.status).toBe(401);
    expect(runWaitlistMatchingJobMock).not.toHaveBeenCalled();
  });

  it("acepta con 200 y dispara el job de lista de espera con el secreto correcto", async () => {
    const res = await fetch(`${baseUrl}/internal/waitlist/run`, {
      method: "POST",
      headers: { "X-Internal-Secret": INTERNAL_SECRET },
    });
    expect(res.status).toBe(200);
    // Fire-and-forget: se dispara de forma asíncrona tras responder.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runWaitlistMatchingJobMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /internal/waitlist/run con WAITLIST_ENABLED=false (interruptor maestro)", () => {
  it("responde 200 pero no corre el job, aunque el secreto sea correcto", async () => {
    vi.resetModules();
    vi.doMock("./config.js", () => ({
      config: {
        DIRECTUS_URL: "https://example.invalid/",
        DIRECTUS_TOKEN: "token",
        YCLOUD_API_KEY: "ycloud-key",
        YCLOUD_WEBHOOK_SECRET: SECRET,
        WHATSAPP_FROM: "+50600000000",
        ANTHROPIC_API_KEY: "anthropic-key",
        ANTHROPIC_MODEL: "claude-sonnet-5",
        PORT: 0,
        CLINIC_TIMEZONE: "America/Guayaquil",
        SLOT_STEP_MINUTES: 15,
        INTERNAL_API_SECRET: INTERNAL_SECRET,
        WAITLIST_ENABLED: false,
      },
    }));

    const { app: appDisabled } = await import("./server.js");
    const server = appDisabled.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/internal/waitlist/run`, {
        method: "POST",
        headers: { "X-Internal-Secret": INTERNAL_SECRET },
      });
      expect(res.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runWaitlistMatchingJobMock).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.doUnmock("./config.js");
      vi.resetModules();
    }
  });
});

describe("processInboundEvent (pipeline completo)", () => {
  const event = {
    id: "evt-1",
    type: "whatsapp.inbound_message.received",
    apiVersion: "v2",
    createTime: "2026-07-10T12:00:00Z",
    whatsappInboundMessage: {
      id: "wamid-1",
      wabaId: "waba-1",
      from: "+50688000001",
      to: "+50600000000",
      sendTime: "2026-07-10T12:00:00Z",
      type: "text",
      text: { body: "Hola, quiero agendar" },
    },
  };

  it("crea/encuentra al paciente, loguea, invoca al agente y envía la respuesta", async () => {
    await processInboundEvent(event);

    expect(findOrCreatePatientMock).toHaveBeenCalledWith("88000001", CLINIC.id);
    expect(logMessageMock).toHaveBeenNthCalledWith(1, "patient-1", "in", "Hola, quiero agendar", "wamid-1");
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.any(Array),
      { telefono: "88000001", titularId: "patient-1", clinic: CLINIC },
      [PATIENT],
    );
    expect(sendTextMock).toHaveBeenCalledWith("+50688000001", "Respuesta del agente", CLINIC);
    expect(logMessageMock).toHaveBeenNthCalledWith(2, "patient-1", "out", "Respuesta del agente");
  });

  it("ignora eventos que no son mensajes entrantes de texto", async () => {
    await processInboundEvent({ ...event, type: "whatsapp.message.updated" });
    await processInboundEvent({
      ...event,
      whatsappInboundMessage: { ...event.whatsappInboundMessage, type: "image", text: undefined },
    });

    expect(findOrCreatePatientMock).not.toHaveBeenCalled();
    expect(runAgentTurnMock).not.toHaveBeenCalled();
  });

  it("fusiona turnos consecutivos del mismo rol en el historial pasado al agente", async () => {
    getRecentMessagesMock.mockResolvedValue([
      { id: "m1", patient: "patient-1", direccion: "in", contenido: "Hola" },
      { id: "m2", patient: "patient-1", direccion: "in", contenido: "¿Están abiertos hoy?" },
      { id: "m3", patient: "patient-1", direccion: "out", contenido: "Sí, claro" },
    ]);

    await processInboundEvent(event);

    const conversation = runAgentTurnMock.mock.calls[0]?.[0];
    expect(conversation).toEqual([
      { role: "user", content: "Hola\n¿Están abiertos hoy?" },
      { role: "assistant", content: "Sí, claro" },
    ]);
  });
});
