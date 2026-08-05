import { config } from "../config.js";
import type { ClinicRow } from "../directus.js";

const BASE_URL = "https://api.ycloud.com/v2";

export interface YCloudButton {
  id: string;
  title: string;
}

export interface YCloudListRow {
  id: string;
  title: string;
  description?: string;
}

export interface YCloudListSection {
  title: string;
  rows: YCloudListRow[];
}

/**
 * Credenciales de envío a usar. Si una clínica no configuró las suyas
 * propias (`ycloud_api_key`/`whatsapp_numero` vacíos en `clinics`), se cae a
 * las variables de entorno globales — así el despliegue de una sola clínica
 * sigue funcionando sin tocar YCloud.
 */
function resolveCredentials(clinic?: ClinicRow): { apiKey: string; from: string | undefined } {
  return {
    apiKey: clinic?.ycloud_api_key || config.YCLOUD_API_KEY || "",
    from: clinic?.whatsapp_numero || config.WHATSAPP_FROM,
  };
}

async function sendDirectly(body: Record<string, unknown>, clinic?: ClinicRow): Promise<void> {
  const { apiKey } = resolveCredentials(clinic);
  const res = await fetch(`${BASE_URL}/whatsapp/messages/sendDirectly`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`YCloud API error ${res.status}: ${errText}`);
  }
}

/** Envía un mensaje de texto simple. `clinic` es opcional: si se omite, usa las credenciales globales (compatibilidad con despliegue de una sola clínica). */
export async function sendText(to: string, text: string, clinic?: ClinicRow): Promise<void> {
  await sendDirectly(
    {
      from: resolveCredentials(clinic).from,
      to,
      type: "text",
      text: { body: text },
    },
    clinic,
  );
}

/**
 * Envía un mensaje usando una plantilla aprobada por Meta (HSM), única forma
 * de iniciar contacto fuera de la ventana de sesión de 24h (ej. recordatorios).
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
  clinic?: ClinicRow,
): Promise<void> {
  await sendDirectly(
    {
      from: resolveCredentials(clinic).from,
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
        ],
      },
    },
    clinic,
  );
}

/** Envía un mensaje interactivo con hasta 3 botones de respuesta rápida. */
export async function sendButtons(
  to: string,
  bodyText: string,
  buttons: YCloudButton[],
  clinic?: ClinicRow,
): Promise<void> {
  await sendDirectly(
    {
      from: resolveCredentials(clinic).from,
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
        },
      },
    },
    clinic,
  );
}

/** Envía un mensaje interactivo con una lista de opciones agrupadas por secciones. */
export async function sendList(
  to: string,
  bodyText: string,
  buttonLabel: string,
  sections: YCloudListSection[],
  clinic?: ClinicRow,
): Promise<void> {
  await sendDirectly(
    {
      from: resolveCredentials(clinic).from,
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: { button: buttonLabel, sections },
      },
    },
    clinic,
  );
}
