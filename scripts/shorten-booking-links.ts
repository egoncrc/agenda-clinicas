/**
 * Genera con Short.io el link corto del formulario público de agendar de cada
 * clínica y lo guarda en `clinics.booking_short_url`, que es lo que la pantalla
 * Mensajes del panel pega en el texto de cancelación ("Agende su cita aquí: ...").
 *
 * Uso:
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token_admin> \
 *   SHORTIO_API_KEY=... SHORTIO_DOMAIN=citas.short.gy \
 *   npx tsx scripts/shorten-booking-links.ts [--dry-run] [--force]
 *
 * POR QUÉ UN SCRIPT Y NO EL PANEL: la API key de Short.io permite crear, editar
 * y BORRAR links del dominio — o sea, redirigir a donde sea un link que ya está
 * en manos de pacientes. El panel es un bundle estático público, cualquier
 * `VITE_*` queda legible con las herramientas de desarrollador. La key solo la
 * ve este script, corrido a mano, igual que DIRECTUS_ADMIN_TOKEN.
 *
 * POR QUÉ UNA VEZ POR CLÍNICA Y NO POR MENSAJE: el link de agendar es fijo por
 * clínica (`/agendar?clinica=<uuid>`), así que no hay nada que acortar en tiempo
 * de render. De paso, un solo link por clínica deja las estadísticas de clics
 * agregadas en el panel de Short.io, que es lo que sirve.
 *
 * Idempotente: una clínica que ya tiene `booking_short_url` se omite. Eso es a
 * propósito y es lo importante — regenerar un link que ya circula impreso en
 * mensajes enviados rompería los que están en el teléfono de los pacientes.
 * `--force` lo salta, con conocimiento de causa.
 */
import "dotenv/config";
import { createDirectus, rest, staticToken, readItems, updateItem } from "@directus/sdk";

const url = process.env.DIRECTUS_URL;
const token = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !token) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN).");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const SHORTIO_API_KEY = process.env.SHORTIO_API_KEY;
const SHORTIO_DOMAIN = process.env.SHORTIO_DOMAIN;
if (!DRY_RUN && (!SHORTIO_API_KEY || !SHORTIO_DOMAIN)) {
  console.error("Faltan SHORTIO_API_KEY y SHORTIO_DOMAIN (el dominio configurado en Short.io, ej. citas.short.gy).");
  process.exit(1);
}

/** Base del panel; el path `/agendar` es la ruta pública del SPA (clinica/src/router/index.ts). */
const PANEL_BASE_URL = process.env.PANEL_BASE_URL ?? "https://panel.egonia.site";

const SHORTIO_API_URL = "https://api.short.io/links";

const client = createDirectus(url).with(staticToken(token)).with(rest());

interface ClinicRow {
  id: string;
  nombre: string;
  activo: boolean;
  booking_short_url?: string | null;
}

/** URL larga que el link corto debe resolver — la misma que hoy genera bookingLink() sin acortador. */
function longBookingUrl(clinicId: string): string {
  return `${PANEL_BASE_URL}/agendar?clinica=${clinicId}`;
}

/**
 * Path legible a partir del nombre ("Clínica Central" -> "clinica-central"), para
 * que el link diga algo en vez de un hash. Es solo una preferencia: si el path ya
 * está ocupado, Short.io responde 409 y se reintenta dejándoselo elegir a él.
 */
function slugify(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface ShortioLink {
  shortURL: string;
  idString?: string;
}

async function createShortLink(clinic: ClinicRow, withPath: boolean): Promise<Response> {
  const body: Record<string, unknown> = {
    originalURL: longBookingUrl(clinic.id),
    domain: SHORTIO_DOMAIN,
    title: `Agendar — ${clinic.nombre}`,
    // Reintentar devuelve el link existente en vez de crear un duplicado.
    allowDuplicates: false,
  };
  if (withPath) body.path = slugify(clinic.nombre);

  return fetch(SHORTIO_API_URL, {
    method: "POST",
    headers: {
      Authorization: SHORTIO_API_KEY!,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function shortenFor(clinic: ClinicRow): Promise<string> {
  let res = await createShortLink(clinic, true);

  // 409 = el path preferido ya está tomado (otra clínica con nombre parecido, o
  // un link viejo). Se reintenta una sola vez sin `path` y Short.io asigna uno.
  if (res.status === 409) {
    console.log(`  · path "${slugify(clinic.nombre)}" ocupado, dejando que Short.io asigne uno`);
    res = await createShortLink(clinic, false);
  }

  if (!res.ok) {
    throw new Error(`Short.io respondió ${res.status}: ${await res.text()}`);
  }

  const link = (await res.json()) as ShortioLink;
  if (!link.shortURL) throw new Error(`Short.io no devolvió shortURL: ${JSON.stringify(link)}`);
  return link.shortURL;
}

async function main() {
  console.log(`Acortando links de agendar en ${url} ...`);
  if (DRY_RUN) console.log("(--dry-run: no se llama a Short.io ni se escribe en Directus)\n");

  const clinics = (await client.request(
    readItems("clinics" as never, {
      filter: { activo: { _eq: true } },
      fields: ["id", "nombre", "activo", "booking_short_url"],
      sort: ["nombre"],
      limit: -1,
    } as never),
  )) as unknown as ClinicRow[];

  let creados = 0;
  let omitidos = 0;

  for (const clinic of clinics) {
    const label = `${clinic.nombre} (${clinic.id})`;

    if (clinic.booking_short_url && !FORCE) {
      console.log(`  · ${label}: ya tiene ${clinic.booking_short_url}`);
      omitidos++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  → ${label}: acortaría ${longBookingUrl(clinic.id)} como /${slugify(clinic.nombre)}`);
      creados++;
      continue;
    }

    try {
      const shortURL = await shortenFor(clinic);
      await client.request(updateItem("clinics" as never, clinic.id, { booking_short_url: shortURL } as never));
      console.log(`  ✓ ${label}: ${shortURL}`);
      creados++;
    } catch (err) {
      console.error(`  ✗ ${label}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nListo. ${creados} link(s) generado(s), ${omitidos} omitido(s) por ya tener uno.`);
  if (creados > 0 && !DRY_RUN) {
    console.log("Siguiente paso: desplegar el panel para que la pantalla Mensajes use el link corto.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
