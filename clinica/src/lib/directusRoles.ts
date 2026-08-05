import { readRoles } from "@directus/sdk";
import { directus } from "@/lib/directus";

/** `directus_users`/`directus_roles` no están en el `Schema` local (ver CLAUDE.md, hueco de tipado del SDK) — de ahí el `as never`. */
export async function getRoleId(name: "Doctor" | "Receptionist"): Promise<string | undefined> {
  const roles = (await directus.request(
    readRoles({ filter: { name: { _eq: name } }, fields: ["id", "name"] } as never),
  )) as { id: string; name: string }[];
  return roles[0]?.id;
}
