import { defineHook } from "@directus/extensions-sdk";

/**
 * Genera con Short.io el link corto del formulario público de agendar en cuanto
 * se crea una clínica, y lo guarda en `clinics.booking_short_url` — lo mismo que
 * hacía a mano `scripts/shorten-booking-links.ts`, ahora automático.
 *
 * ES UN `action`, NO UN `filter`: crear el link es una llamada de red a un
 * tercero (Short.io) que puede fallar o demorar, y eso nunca debe poder
 * bloquear ni retrasar el alta de la clínica. Si falla, la clínica queda creada
 * igual con `booking_short_url` en null; `scripts/shorten-booking-links.ts`
 * sigue existiendo como red de seguridad para backfill (es idempotente: una
 * clínica que ya tiene link se omite).
 *
 * POR QUÉ LA API KEY SÍ PUEDE VIVIR AQUÍ Y NO EN EL PANEL: este hook corre
 * server-side dentro del contenedor de Directus, no en el bundle público de la
 * SPA. La razón por la que el script original es manual (ver su cabecera) es
 * que la key de Short.io puede editar/borrar links ya en manos de pacientes si
 * queda expuesta en un `VITE_*`; un env var del contenedor de Directus no tiene
 * ese problema.
 *
 * `accountability: null` al escribir: quien crea la clínica (típicamente un
 * admin desde el panel) puede no tener permiso de escritura sobre
 * `booking_short_url` si ese campo no está en su whitelist — la escritura de
 * este hook no debe depender de eso, mismo criterio que el resto de hooks de
 * este repo.
 */

interface ClinicRow {
  id: string;
  nombre?: string;
  booking_short_url?: string | null;
}

interface ShortioLink {
  shortURL: string;
}

const SHORTIO_API_URL = "https://api.short.io/links";

/** Debe coincidir con el path público que usa el panel (clinica/src/router/index.ts). */
function longBookingUrl(panelBaseUrl: string, clinicId: string): string {
  return `${panelBaseUrl}/agendar?clinica=${clinicId}`;
}

/** "Clínica Central" -> "clinica-central". Solo estético: si el path ya está tomado, Short.io asigna otro. */
function slugify(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default defineHook(({ action }, { services, database, getSchema, logger }) => {
  const { ItemsService } = services;

  const apiKey = process.env.SHORTIO_API_KEY;
  const domain = process.env.SHORTIO_DOMAIN;
  const panelBaseUrl = process.env.PANEL_BASE_URL ?? "https://agendamedicacr.com";

  async function createShortLink(clinic: ClinicRow, withPath: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      originalURL: longBookingUrl(panelBaseUrl, clinic.id),
      domain,
      title: `Agendar — ${clinic.nombre ?? clinic.id}`,
      allowDuplicates: false,
    };
    if (withPath && clinic.nombre) body.path = slugify(clinic.nombre);

    return fetch(SHORTIO_API_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async function shortenFor(clinic: ClinicRow): Promise<string> {
    let res = await createShortLink(clinic, true);

    // 409 = el path preferido ya está tomado (otra clínica con nombre parecido).
    // Se reintenta una sola vez sin `path` y Short.io asigna uno.
    if (res.status === 409) {
      res = await createShortLink(clinic, false);
    }

    if (!res.ok) {
      throw new Error(`Short.io respondió ${res.status}: ${await res.text()}`);
    }

    const link = (await res.json()) as ShortioLink;
    if (!link.shortURL) throw new Error(`Short.io no devolvió shortURL: ${JSON.stringify(link)}`);
    return link.shortURL;
  }

  action("clinics.items.create", async ({ key }, { schema }) => {
    if (!apiKey || !domain) {
      logger.warn(
        "[clinic-booking-link-hook] Faltan SHORTIO_API_KEY/SHORTIO_DOMAIN en el entorno de Directus; se omite la generación del link corto.",
      );
      return;
    }

    const clinics = new ItemsService("clinics", {
      schema: schema ?? (await getSchema()),
      accountability: null,
      knex: database,
    });

    const clinic = (await clinics.readOne(key, {
      fields: ["id", "nombre", "booking_short_url"],
    })) as ClinicRow | null;

    // Ya tiene link (poco probable en un create, pero barato de chequear) o no existe: nada que hacer.
    if (!clinic || clinic.booking_short_url) return;

    try {
      const shortURL = await shortenFor(clinic);
      await clinics.updateOne(clinic.id, { booking_short_url: shortURL });
      logger.info(`[clinic-booking-link-hook] Link generado para "${clinic.nombre}": ${shortURL}`);
    } catch (err) {
      logger.error(
        `[clinic-booking-link-hook] No se pudo generar el link para "${clinic.nombre}" (${clinic.id}): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  });
});
