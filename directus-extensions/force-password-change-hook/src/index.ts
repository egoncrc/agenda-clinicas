import { defineHook } from "@directus/extensions-sdk";

/**
 * Apaga `directus_users.must_change_password` cuando el usuario cambia su
 * contraseña de verdad.
 *
 * El campo es lo que atrapa a un usuario recién dado de alta (o recién
 * reseteado por el admin) en la pantalla `/cambiar-clave` del panel. Para que
 * el forzado no sea puramente cosmético, el usuario NO tiene permiso de
 * escritura sobre ese campo: si lo tuviera, podría apagarlo con un
 * `PATCH /users/me {"must_change_password": false}` y saltarse el cambio sin
 * tocar su contraseña. Alguien tiene que apagarlo por él — este hook.
 *
 * Es un `action` y no un `filter`, al revés que `appointments-overlap-guard`.
 * La variante `filter` sería más simple y atómica (inyectar
 * `must_change_password: false` en el mismo payload, sin ItemsService), pero
 * el filter corre ANTES de validar el payload contra los permisos de campo del
 * usuario: el payload mutado incluiría un campo que el usuario no puede
 * escribir — que es justo el requisito — y todo cambio de contraseña de un
 * usuario normal terminaría en 403. Como admin funcionaría perfecto, así que es
 * un fallo que se escapa fácil en pruebas.
 */

/** Campo custom creado por `scripts/provision-password-management.ts`. */
const FLAG_FIELD = "must_change_password";

export default defineHook(({ action }, { services, database, getSchema }) => {
  const { ItemsService } = services;

  async function clearFlag(keys: string[]): Promise<void> {
    const schema = await getSchema();

    // `accountability: null` = acceso de sistema. Aquí es OBLIGATORIO, no una
    // comodidad: el propio usuario no tiene permiso de escritura sobre este
    // campo (ese es el requisito), así que la escritura no puede heredar su
    // accountability o se rechazaría a sí misma.
    const users = new ItemsService("directus_users", { schema, accountability: null, knex: database });

    // `emitEvents: false` corta la recursión de raíz. Al revés que
    // `time-off-cascade-hook`, que SÍ deja los eventos porque necesita despertar
    // a `waitlist-notify-hook`; aquí no hay nada río abajo que deba enterarse.
    // Doble cinturón: aunque el evento se emitiera, el segundo payload no lleva
    // `password` y la guarda 1 de abajo retorna.
    await users.updateMany(keys, { [FLAG_FIELD]: false }, { emitEvents: false });
  }

  // `directus_users` -> scope `users` (Directus quita el prefijo `directus_`).
  // `PATCH /users/me` pasa por `UsersService.updateOne` -> `ItemsService.updateMany`,
  // así que emite el evento igual que `PATCH /users/{id}`.
  action("users.update", (meta) => {
    const payload = (meta.payload ?? {}) as Record<string, unknown>;

    // Guarda 1 — solo reacciona a cambios reales de contraseña.
    if (!("password" in payload)) return;

    // Guarda 2 — si quien escribe fijó la bandera explícitamente, gana la
    // intención explícita. Es lo que permite al admin hacer el reset en UN solo
    // PATCH {password, must_change_password: true} sin que este hook se lo
    // revierta a false medio segundo después. Sin esta guarda el botón
    // "Restablecer contraseña" del panel sería inútil, y de forma silenciosa.
    if (payload[FLAG_FIELD] !== undefined) return;

    const keys = (Array.isArray(meta.keys) ? meta.keys : [meta.keys]).filter(Boolean).map(String);
    if (keys.length === 0) return;

    // No es atómico (a diferencia del `filter`): si este updateMany falla, la
    // contraseña ya quedó cambiada y la bandera sigue en true, así que al
    // usuario se le vuelve a pedir el cambio. Falla del lado seguro.
    //
    // Un fallo tampoco debe propagarse: la contraseña ya está escrita y la
    // petición ya respondió.
    void clearFlag(keys).catch((err) => {
      console.error(
        `[force-password-change-hook] No se pudo apagar ${FLAG_FIELD} de ${keys.join(", ")}:`,
        err,
      );
    });
  });

  // `users.create` NO se escucha a propósito: el alta de usuarios (wizard y
  // modales del panel) manda `must_change_password: true` explícito junto con la
  // contraseña temporal, y el hook no debe pisarlo.
});
