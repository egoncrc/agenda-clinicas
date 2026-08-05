import { createHmac, timingSafeEqual } from "node:crypto";

/** Ventana de tolerancia para el timestamp de la firma, en segundos (evita replay de una petición capturada). */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Verifica la firma HMAC-SHA256 del webhook de YCloud.
 *
 * Header esperado: `YCloud-Signature: t=<timestamp_unix_segundos>,s=<firma_hex>`
 * La firma se calcula sobre `"${timestamp}.${rawBody}"` usando el secreto
 * del endpoint (se obtiene al configurar el webhook en el dashboard de YCloud).
 * También se exige que el timestamp esté dentro de una ventana reciente, para
 * que una petición válida capturada no se pueda reenviar indefinidamente.
 */
export function verifyYCloudSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  if (!signatureHeader) return false;

  const parts = new Map(
    signatureHeader.split(",").map((kv) => {
      const [key, value] = kv.split("=");
      return [key, value] as [string, string | undefined];
    }),
  );
  const timestamp = parts.get("t");
  const signature = parts.get("s");
  if (!timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expectedHex = createHmac("sha256", secret).update(signedPayload).digest("hex");

  const expectedBuf = Buffer.from(expectedHex, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
