import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyYCloudSignature } from "./signature.js";

const SECRET = "test-secret";
const NOW = 1_700_000_000; // instante de referencia para las pruebas (unix segundos)

function sign(timestamp: string, body: string, secret = SECRET): string {
  const signedPayload = `${timestamp}.${body}`;
  const hex = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},s=${hex}`;
}

describe("verifyYCloudSignature", () => {
  it("acepta una firma válida y reciente", () => {
    const body = JSON.stringify({ hello: "world" });
    const header = sign(String(NOW), body);
    expect(verifyYCloudSignature(Buffer.from(body), header, SECRET, NOW)).toBe(true);
  });

  it("rechaza si el body fue alterado", () => {
    const body = JSON.stringify({ hello: "world" });
    const header = sign(String(NOW), body);
    const tampered = JSON.stringify({ hello: "mundo" });
    expect(verifyYCloudSignature(Buffer.from(tampered), header, SECRET, NOW)).toBe(false);
  });

  it("rechaza con el secreto incorrecto", () => {
    const body = JSON.stringify({ hello: "world" });
    const header = sign(String(NOW), body, "otro-secreto");
    expect(verifyYCloudSignature(Buffer.from(body), header, SECRET, NOW)).toBe(false);
  });

  it("rechaza si falta el header", () => {
    expect(verifyYCloudSignature(Buffer.from("{}"), undefined, SECRET, NOW)).toBe(false);
  });

  it("rechaza un header mal formado", () => {
    expect(verifyYCloudSignature(Buffer.from("{}"), "not-a-valid-header", SECRET, NOW)).toBe(false);
  });

  it("rechaza una firma válida pero con timestamp demasiado viejo (replay)", () => {
    const body = JSON.stringify({ hello: "world" });
    const oldTimestamp = NOW - 301; // justo fuera de la ventana de 300s
    const header = sign(String(oldTimestamp), body);
    expect(verifyYCloudSignature(Buffer.from(body), header, SECRET, NOW)).toBe(false);
  });

  it("rechaza un timestamp demasiado adelantado", () => {
    const body = JSON.stringify({ hello: "world" });
    const futureTimestamp = NOW + 301;
    const header = sign(String(futureTimestamp), body);
    expect(verifyYCloudSignature(Buffer.from(body), header, SECRET, NOW)).toBe(false);
  });

  it("acepta un timestamp dentro de la ventana de tolerancia", () => {
    const body = JSON.stringify({ hello: "world" });
    const header = sign(String(NOW - 299), body);
    expect(verifyYCloudSignature(Buffer.from(body), header, SECRET, NOW)).toBe(true);
  });
});
