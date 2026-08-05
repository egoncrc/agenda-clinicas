/**
 * Crea (somete a revisión de Meta) las plantillas de WhatsApp usadas por los
 * recordatorios de cita (Fase 8). Es idempotente: si una plantilla ya existe,
 * la omite y continúa.
 *
 * Uso:
 *   YCLOUD_API_KEY=... YCLOUD_WABA_ID=... npm run create-templates
 *
 * Nota: esto somete las plantillas a revisión real de Meta (horas a 1-2 días).
 */
import "dotenv/config";

const apiKey = process.env.YCLOUD_API_KEY;
const wabaId = process.env.YCLOUD_WABA_ID;
if (!apiKey || !wabaId) {
  console.error("Faltan YCLOUD_API_KEY y/o YCLOUD_WABA_ID.");
  process.exit(1);
}

const BASE_URL = "https://api.ycloud.com/v2";
const LANGUAGE = "es";

interface TemplateDef {
  name: string;
  bodyText: string;
}

const TEMPLATES: TemplateDef[] = [
  {
    name: "recordatorio_cita_24h",
    bodyText:
      "Hola {{1}}, te recordamos tu cita de {{2}} con {{3}} mañana {{4}}. Si necesitas cambiarla o cancelarla, respóndenos por este medio.",
  },
  {
    name: "recordatorio_cita_2h",
    bodyText:
      "Hola {{1}}, tu cita de {{2}} con {{3}} es hoy {{4}} (en unas 2 horas). Si necesitas cambiarla o cancelarla, respóndenos por este medio.",
  },
  {
    name: "lista_espera_cita_agendada",
    bodyText:
      "Hola {{1}}, te agendamos automáticamente tu cita de {{2}} con {{3}} el {{4}} a las {{5}} (estabas en lista de espera). Si no podés asistir, respondé por este medio para cancelar o reprogramar.",
  },
];

function isAlreadyExists(err: unknown): boolean {
  const msg = JSON.stringify((err as { message?: unknown })?.message ?? err ?? "");
  return /exist|duplicate|already/i.test(msg);
}

async function createTemplate(def: TemplateDef): Promise<void> {
  const res = await fetch(`${BASE_URL}/whatsapp/templates`, {
    method: "POST",
    headers: { "X-API-Key": apiKey!, "Content-Type": "application/json" },
    body: JSON.stringify({
      wabaId,
      name: def.name,
      language: LANGUAGE,
      category: "UTILITY",
      components: [{ type: "BODY", text: def.bodyText }],
    }),
  });

  if (res.ok) {
    console.log(`  ✓ plantilla ${def.name} enviada a revisión`);
    return;
  }

  const body = await res.json().catch(() => ({}));
  if (isAlreadyExists(body)) {
    console.log(`  · plantilla ${def.name} (ya existía)`);
    return;
  }
  console.error(`  ✗ plantilla ${def.name}`, JSON.stringify(body));
}

async function main() {
  console.log(`Creando plantillas de WhatsApp en WABA ${wabaId} ...`);
  for (const def of TEMPLATES) {
    await createTemplate(def);
  }
  console.log("\nListo. El estado de revisión se puede consultar en YCloud o Meta Business Manager.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
