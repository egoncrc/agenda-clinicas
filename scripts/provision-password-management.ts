/**
 * Provisiona lo que el módulo de contraseñas del panel necesita del lado de
 * Directus: el campo custom `must_change_password` en la colección de sistema
 * `directus_users`, más un diagnóstico de los permisos que hacen que el flujo
 * funcione (o que lo romperían).
 *
 * Uso:
 *   DIRECTUS_URL=... DIRECTUS_ADMIN_TOKEN=<token_admin> npm run provision:passwords
 *   ... npm run provision:passwords -- --fix-permissions    (ver más abajo)
 *
 * Idempotente igual que `provision-clinics.ts`: si el campo ya existe, lo omite.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTANTE — la invariante `fields: ["*"]` de `provision-clinic-permissions.ts`
 * NO aplica a `directus_users`, y aquí está prohibida.
 *
 * En una colección de contenido el borde de seguridad es el filtro de fila
 * (`clinic.recepcionistas... = $CURRENT_USER`) y `fields: ["*"]` solo existe
 * para evitar el bug de 403 en consultas filtradas/agregadas.
 *
 * En `directus_users` la situación se invierte: el filtro de fila
 * (`id = $CURRENT_USER`) es trivial y LA LISTA DE CAMPOS ES EL BORDE. Una fila
 * `{collection: "directus_users", action: "update", fields: ["*"]}` permitiría
 * `PATCH /users/me {"role": "<id de Administrator>"}` — escalación a admin.
 *
 * Y como Directus UNE (union) los permisos de todas las policies aplicables,
 * agregar esa fila no restringe nada: se suma a la lista blanca que Directus ya
 * inyecta (`appAccessMinimalPermissions`) y la vuelve total. Por eso este script
 * usa listas de campos explícitas y nunca crea un `update` sobre esta colección.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sobre `appAccessMinimalPermissions` — CORREGIDO tras verificarlo con una cuenta
 * real: la documentación de Directus sugiere que toda policy con `app_access:
 * true` hereda gratis `read`+`update` sobre su propia fila de `directus_users`.
 * En esta instancia (Directus 11.14) **eso no se cumple**: se probó con una
 * cuenta Doctor real y un `PATCH /users/me {"first_name": "..."}` sin ninguna
 * fila de permiso explícita dio 403 llano. O sea, además del `read` (que si
 * hacía falta, y por eso existe `--fix-permissions` para él), **también hay que
 * crear a mano la fila de `update`** — con lista de campos explícita
 * (`password`, `first_name`, `last_name`), nunca `["*"]` (ver advertencia de
 * arriba: en esta colección `fields` es el borde de seguridad).
 *
 * Correr `--fix-permissions` agrega, por policy, lo que falte de:
 * - `read` mínimo y ADITIVO sobre `id`/`email`/`first_name`/`last_name`/el campo
 *   custom — solo si no existe ya una fila de `read` (si existe, se respeta y
 *   se pide revisar a mano, para no pisar un filtro que alguien puso a propósito).
 * - `update` explícito sobre `password`/`first_name`/`last_name` — solo si no
 *   existe ya una fila de `update` (mismo criterio de no pisar nada existente).
 */
import "dotenv/config";
import {
  createDirectus,
  rest,
  staticToken,
  createField,
  readPolicies,
  readPermissions,
  createPermission,
} from "@directus/sdk";

const url = process.env.DIRECTUS_URL;
const token = process.env.DIRECTUS_ADMIN_TOKEN ?? process.env.DIRECTUS_TOKEN;
if (!url || !token) {
  console.error("Faltan DIRECTUS_URL y DIRECTUS_ADMIN_TOKEN (o DIRECTUS_TOKEN).");
  process.exit(1);
}

const client = createDirectus(url).with(staticToken(token)).with(rest());

/** Policies del panel a las que aplica el flujo de contraseñas. */
const APP_POLICIES = ["Doctor", "Receptionist"];

const FLAG_FIELD = "must_change_password";

function isAlreadyExists(err: unknown): boolean {
  const msg = JSON.stringify((err as { errors?: unknown })?.errors ?? err ?? "");
  return /exist|duplicate|already/i.test(msg);
}

async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    if (isAlreadyExists(err)) {
      console.log(`  · ${label} (ya existía)`);
    } else {
      console.error(`  ✗ ${label}`, JSON.stringify((err as { errors?: unknown })?.errors ?? err));
    }
  }
}

/**
 * Crea el campo custom. `POST /fields/directus_users` funciona sobre colecciones
 * de sistema — mismo endpoint ya usado en este proyecto para el alias reverso
 * `patients.appointments` (ver CLAUDE.md, scoping de la policy Dentist).
 *
 * `default_value: false` hace que el `ALTER TABLE ... ADD COLUMN` de Postgres
 * rellene las filas existentes con `false`: nadie que hoy tenga cuenta queda
 * marcado. Aun así el panel compara siempre con `=== true`, nunca `!== false`.
 *
 * `readonly: true` es SOLO cosmético (afecta al admin app de Directus, no a la
 * API). La protección real contra que el usuario se lo apague solo es la lista
 * de campos de sus permisos.
 *
 * Sin `special: ["cast-boolean"]`: eso es para backends sin boolean nativo, y
 * acá hay Postgres.
 */
async function ensureFlagField(): Promise<void> {
  await safe(`campo directus_users.${FLAG_FIELD}`, () =>
    client.request(
      createField("directus_users" as never, {
        field: FLAG_FIELD,
        type: "boolean",
        schema: { default_value: false, is_nullable: true },
        meta: {
          interface: "boolean",
          readonly: true,
          width: "half",
          note:
            "El usuario debe cambiar su contraseña en el próximo ingreso. Lo pone en true el alta " +
            "de usuarios y el reset del admin; lo apaga solo `force-password-change-hook` cuando " +
            "detecta un cambio real de contraseña. NO editar a mano.",
        },
      } as never),
    ),
  );
}

interface PolicyRow {
  id: string;
  name: string;
  app_access?: boolean;
  admin_access?: boolean;
}

async function readAppPolicies(): Promise<PolicyRow[]> {
  const rows = (await client.request(
    readPolicies({
      filter: { name: { _in: APP_POLICIES } } as never,
      fields: ["id", "name", "app_access", "admin_access"],
      limit: -1,
    } as never),
  )) as PolicyRow[];
  return rows;
}

/**
 * Diagnóstico, no mutación. Dos cosas a mirar:
 *
 * 1. `app_access` en las policies del panel — informativo. NO asumir que
 *    `true` alcanza: en esta instancia no basta (ver docblock del archivo), así
 *    que de todos modos hace falta `--fix-permissions` para read+update.
 * 2. Filas preexistentes sobre `directus_users`. Una con `action: "update"` y
 *    `fields: ["*"]` (o `null`) es una escalación de privilegios ya presente:
 *    ese usuario puede darse el rol de Administrator.
 */
async function diagnose(policies: PolicyRow[]): Promise<void> {
  console.log("\nDiagnóstico de policies:");
  for (const name of APP_POLICIES) {
    const policy = policies.find((p) => p.name === name);
    if (!policy) {
      console.log(`  ✗ policy "${name}" no encontrada`);
      continue;
    }
    console.log(`  · ${name}: app_access=${policy.app_access === true} (informativo — igual hace falta --fix-permissions)`);
  }

  const perms = (await client.request(
    readPermissions({
      filter: { collection: { _eq: "directus_users" } } as never,
      fields: ["id", "action", "fields", "permissions", "policy"],
      limit: -1,
    } as never),
  )) as Array<{ id: number; action: string; fields: string[] | null; policy: string }>;

  console.log("\nPermisos existentes sobre directus_users:");
  if (perms.length === 0) {
    console.log("  · ninguno explícito (todo viene del set mínimo de app)");
  }
  for (const p of perms) {
    const policyName = policies.find((x) => x.id === p.policy)?.name ?? p.policy;
    const fields = p.fields === null ? "null" : JSON.stringify(p.fields);
    const dangerous = p.action === "update" && (p.fields === null || p.fields.includes("*"));
    console.log(`  ${dangerous ? "✗" : "·"} #${p.id} ${policyName} · ${p.action} · fields=${fields}`);
    if (dangerous) {
      console.error(
        `      ESCALACIÓN DE PRIVILEGIOS: ese update permite PATCH /users/me {"role": "<id Administrator>"}. Acotar la lista de campos antes de seguir.`,
      );
    }
  }
}

/**
 * Fila de `read` mínima y aditiva: un solo campo, solo la propia fila. Se une al
 * set mínimo de app, no lo reemplaza.
 *
 * Deliberadamente NO es la `ensurePermission()` de `provision-clinic-permissions.ts`:
 * aquélla fuerza `fields: ["*"]`, que en esta colección es una escalación. Esta
 * exige la lista de campos como parámetro para que sea imposible caer en `["*"]`
 * por descuido, y solo sabe crear `read`.
 */
async function ensureOwnReadPermission(
  policyId: string,
  policyLabel: string,
  fields: string[],
): Promise<void> {
  const existing = (await client.request(
    readPermissions({
      filter: {
        policy: { _eq: policyId },
        collection: { _eq: "directus_users" },
        action: { _eq: "read" },
      } as never,
      limit: 1,
      fields: ["id", "fields"],
    } as never),
  )) as Array<{ id: number; fields: string[] | null }>;

  if (existing[0]) {
    // No se toca: podría estar acotando algo a propósito y ampliarla a ciegas
    // sería justo el error que este archivo intenta evitar.
    console.log(
      `  · ${policyLabel} · directus_users.read ya existe (#${existing[0].id}, fields=${JSON.stringify(existing[0].fields)}) — revisar a mano si falta ${FLAG_FIELD}`,
    );
    return;
  }

  await safe(`crear permiso ${policyLabel} · directus_users.read (${fields.join(",")})`, () =>
    client.request(
      createPermission({
        policy: policyId,
        collection: "directus_users",
        action: "read",
        fields,
        permissions: { id: { _eq: "$CURRENT_USER" } },
      } as never),
    ),
  );
}

/**
 * Fila de `update` explícita: el usuario puede cambiar su propia contraseña
 * (y nombre/apellido), pero la lista de campos NO incluye `must_change_password`,
 * `role`, `status` ni `policies` — eso es lo que hace el forzado real y no
 * saltable. Igual que `ensureOwnReadPermission`, no pisa una fila existente.
 */
async function ensureOwnUpdatePermission(policyId: string, policyLabel: string): Promise<void> {
  const existing = (await client.request(
    readPermissions({
      filter: {
        policy: { _eq: policyId },
        collection: { _eq: "directus_users" },
        action: { _eq: "update" },
      } as never,
      limit: 1,
      fields: ["id", "fields"],
    } as never),
  )) as Array<{ id: number; fields: string[] | null }>;

  if (existing[0]) {
    const dangerous = existing[0].fields === null || existing[0].fields.includes("*");
    console.log(
      `  ${dangerous ? "✗" : "·"} ${policyLabel} · directus_users.update ya existe (#${existing[0].id}, fields=${JSON.stringify(existing[0].fields)})` +
        (dangerous ? " — ESCALACIÓN DE PRIVILEGIOS, acotar a mano." : ""),
    );
    return;
  }

  await safe(`crear permiso ${policyLabel} · directus_users.update (password,first_name,last_name)`, () =>
    client.request(
      createPermission({
        policy: policyId,
        collection: "directus_users",
        action: "update",
        fields: ["password", "first_name", "last_name"],
        permissions: { id: { _eq: "$CURRENT_USER" } },
      } as never),
    ),
  );
}

async function main() {
  const fixPermissions = process.argv.includes("--fix-permissions");

  console.log(`Provisionando gestión de contraseñas en ${url} ...\n`);
  await ensureFlagField();

  const policies = await readAppPolicies();
  await diagnose(policies);

  if (fixPermissions) {
    console.log("\n--fix-permissions: agregando read+update mínimos por policy");
    for (const name of APP_POLICIES) {
      const policy = policies.find((p) => p.name === name);
      if (!policy) continue;
      await ensureOwnReadPermission(policy.id, name, ["id", "email", "first_name", "last_name", FLAG_FIELD]);
      await ensureOwnUpdatePermission(policy.id, name);
    }
  }

  console.log("\nListo. Verificar con una cuenta real de cada rol (token en modo json):");
  console.log(`  GET  /users/me?fields=id,email,${FLAG_FIELD}       -> debe incluir el campo`);
  console.log(`  PATCH /users/me {"password":"..."}                  -> 200`);
  console.log(`  PATCH /users/me {"${FLAG_FIELD}":false}            -> 403 (obligatorio)`);
  console.log(`  PATCH /users/me {"role":"<id Administrator>"}       -> 403 (obligatorio)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
