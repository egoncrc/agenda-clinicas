import { pathToFileURL } from "node:url";
import express from "express";
import { rateLimit } from "express-rate-limit";
import type Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { verifyYCloudSignature } from "./whatsapp/signature.js";
import { sendText } from "./whatsapp/ycloud.js";
import type { YCloudInboundEvent } from "./whatsapp/types.js";
import type { ClinicRow, MessageRow } from "./directus.js";
import { toE164, toLocalPhone } from "./domain/phone.js";
import { findOrCreatePatient, listPatientsByPhone } from "./repositories/patients.js";
import { getRecentMessages, logMessage } from "./repositories/messages.js";
import { getClinicByWhatsappNumber, getDefaultClinic, listActiveClinics } from "./repositories/clinics.js";
import { runAgentTurn } from "./ai/agent.js";
import { startReminderScheduler, startWaitlistScheduler } from "./scheduler.js";
import { runWaitlistMatchingJob } from "./repositories/waitlist.js";
import { publicBookingRouter } from "./publicBooking.js";

/** Cuántos mensajes previos se le pasan al modelo como contexto de la conversación. */
const HISTORY_SIZE = 20;

declare module "express-serve-static-core" {
  interface Request {
    rawBody?: Buffer;
  }
}

const app = express();

// Detrás de Nginx (único reverse proxy, mismo host): confía en el primer hop
// para que req.ip refleje el cliente real, no 127.0.0.1 — necesario tanto
// para el rate limiting de abajo como para que express-rate-limit no
// rechace peticiones con X-Forwarded-For sin "trust proxy" configurado.
app.set("trust proxy", 1);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = Buffer.from(buf);
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * Límite de tasa para el webhook: cada mensaje entrante dispara una llamada a
 * Claude y un envío por YCloud (ambos con costo), así que se acota el tráfico
 * antes de llegar a la lógica de negocio. La firma HMAC ya autentica al
 * remitente real (YCloud); esto es una defensa adicional contra flood/abuso,
 * no el control de acceso principal.
 */
const webhookRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Webhook de YCloud. Resuelve primero a qué clínica pertenece el número que
 * recibió el mensaje (`whatsappInboundMessage.to`) — solo para saber qué
 * secreto de firma usar, es una lectura de solo-consulta, no ejecuta lógica
 * de negocio antes de validar. Valida la firma HMAC con el secreto de esa
 * clínica (o el global si la clínica no tiene uno propio / no hubo match),
 * responde 200 rápido, y procesa el mensaje entrante de forma asíncrona:
 * upsert de paciente, registro del mensaje, invocación del agente de IA
 * (Claude + tools sobre el motor de agenda) y envío de la respuesta.
 */
app.post("/webhook/ycloud", webhookRateLimit, (req, res) => {
  void (async () => {
    try {
      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
      const signatureHeader = req.header("YCloud-Signature");
      const event = req.body as YCloudInboundEvent;
      const to = event.whatsappInboundMessage?.to;

      const clinic = to ? await getClinicByWhatsappNumber(to) : undefined;
      const secret = clinic?.ycloud_webhook_secret || config.YCLOUD_WEBHOOK_SECRET;

      if (secret) {
        const valid = verifyYCloudSignature(rawBody, signatureHeader, secret);
        if (!valid) {
          res.status(401).json({ error: "invalid signature" });
          return;
        }
      }

      res.status(200).json({ received: true });

      void processInboundEvent(event, clinic).catch((err: unknown) => {
        console.error("Error procesando mensaje entrante de WhatsApp:", err);
      });
    } catch (err) {
      // No debe tumbar el proceso (ej. Directus momentáneamente inalcanzable
      // al resolver la clínica): si la respuesta aún no se envió, YCloud
      // reintenta el webhook; si ya se envió, solo se pierde el log de error.
      console.error("Error resolviendo el webhook de YCloud:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "internal error" });
      }
    }
  })();
});

/**
 * Convierte el historial guardado en turnos alternados user/assistant como
 * exige la API de Claude. Si por alguna razón quedaron dos mensajes seguidos
 * con la misma dirección (ej. el paciente mandó varios mensajes antes de que
 * el bot alcanzara a responder el primero), se fusionan en un solo turno.
 */
function toConversation(history: MessageRow[]): Anthropic.MessageParam[] {
  const conversation: Anthropic.MessageParam[] = [];
  for (const m of history) {
    const role = m.direccion === "in" ? "user" : "assistant";
    const last = conversation[conversation.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content += `\n${m.contenido}`;
    } else {
      conversation.push({ role, content: m.contenido });
    }
  }
  return conversation;
}

/**
 * `clinic` viene ya resuelto por el handler del webhook (a partir de
 * `msg.to`) para no repetir el lookup; se acepta como parámetro también para
 * que los tests puedan invocar esta función directamente (ver server.test.ts).
 */
export async function processInboundEvent(event: YCloudInboundEvent, clinic?: ClinicRow): Promise<void> {
  if (event.type !== "whatsapp.inbound_message.received") return;

  const msg = event.whatsappInboundMessage;
  if (!msg || msg.type !== "text" || !msg.text) return;

  const resolvedClinic = clinic ?? (await getDefaultClinic());
  if (!resolvedClinic) {
    console.error(
      `No se pudo resolver la clínica para el mensaje entrante a ${msg.to}: no hay match de whatsapp_numero ni una única clínica activa de respaldo.`,
    );
    return;
  }

  // `msg.from` llega en E.164; `patients.telefono` se guarda en formato local (sin +506).
  const telefonoLocal = toLocalPhone(msg.from);

  // El titular es el dueño del número: identidad conversacional y dueño del historial.
  const titular = await findOrCreatePatient(telefonoLocal, resolvedClinic.id);
  await logMessage(titular.id, "in", msg.text.body, msg.id);

  const history = await getRecentMessages(titular.id, HISTORY_SIZE);
  const conversation = toConversation(history);

  // Grupo del número (titular + familiares) para que el agente pueda gestionar sus citas.
  const household = await listPatientsByPhone(telefonoLocal, resolvedClinic.id);
  const reply = await runAgentTurn(
    conversation,
    { telefono: telefonoLocal, titularId: titular.id, clinic: resolvedClinic },
    household,
  );
  await sendText(toE164(telefonoLocal), reply, resolvedClinic);
  await logMessage(titular.id, "out", reply);
}

/**
 * Disparado por el hook de Directus (waitlist-notify-hook) tras cualquier
 * cambio en una cita, para reaccionar de inmediato a un cupo liberado en vez
 * de esperar al barrido periódico de respaldo (ver scheduler.ts). Mismo host
 * (127.0.0.1), protegido por un secreto compartido — no es un endpoint
 * público. Ack rápido + procesamiento asíncrono, mismo patrón que el webhook
 * de YCloud.
 */
app.post("/internal/waitlist/run", (req, res) => {
  if (!config.INTERNAL_API_SECRET || req.header("X-Internal-Secret") !== config.INTERNAL_API_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // WAITLIST_ENABLED es el interruptor maestro (igual que REMINDERS_ENABLED):
  // con el secreto ya configurado en ambos lados, el hook de Directus podría
  // disparar este endpoint en cualquier cambio de cita, así que también debe
  // respetar el apagado explícito, no solo el scheduler periódico.
  if (!config.WAITLIST_ENABLED) {
    res.status(200).json({ received: true, skipped: "WAITLIST_ENABLED=false" });
    return;
  }

  res.status(200).json({ received: true });

  // El hook de Directus que dispara esto no sabe de qué clínica era la cita
  // que cambió, así que se re-evalúan todas las clínicas activas (mismo
  // costo que tenía la corrida global antes de multi-clínica, solo que
  // ahora subdividido).
  void (async () => {
    try {
      for (const clinic of await listActiveClinics()) {
        await runWaitlistMatchingJob(clinic).catch((err: unknown) => {
          console.error(`Error en el job de lista de espera (disparado por evento, clínica ${clinic.id}):`, err);
        });
      }
    } catch (err) {
      console.error("Error listando clínicas activas para el job de lista de espera:", err);
    }
  })();
});

app.use("/public/booking", publicBookingRouter);

// Error handler de la API pública de agendamiento: nunca exponer detalles
// internos (stack traces, errores de Directus) a un cliente anónimo.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Error inesperado en la API pública de agendamiento:", err);
  res.status(500).json({ error: "Ocurrió un error inesperado. Intenta de nuevo más tarde." });
});

export { app };

// Solo escucha si el archivo se ejecuta directamente (no cuando lo importa un test).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  app.listen(config.PORT, () => {
    console.log(`Servidor escuchando en el puerto ${config.PORT}`);
  });
  if (config.REMINDERS_ENABLED) {
    startReminderScheduler();
  }
  if (config.WAITLIST_ENABLED) {
    startWaitlistScheduler();
  }
}
