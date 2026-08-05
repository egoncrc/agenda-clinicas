import { defineHook } from "@directus/extensions-sdk";

/**
 * Rellena la trazabilidad de la cancelación (`cancelado_en`, `cancelado_por`)
 * cuando una cita pasa a estado `cancelada`, venga de donde venga la escritura.
 *
 * POR QUÉ EN UN HOOK Y NO EN CADA ESCRITOR: hay cuatro caminos distintos para
 * cancelar una cita (el panel de recepción, el bot de WhatsApp, el
 * `time-off-cascade-hook` y el admin de Directus a mano), y el reporte de
 * cancelaciones necesita que los cuatro dejen el rastro. Repartir la
 * responsabilidad garantiza que tarde o temprano uno se olvide y el reporte
 * quede con huecos que nadie nota hasta que hacen falta. Aquí es imposible
 * saltárselo.
 *
 * Los escritores sí aportan `motivo_cancelacion` — es lo único de los tres que
 * el hook no puede adivinar — y pueden mandar `cancelado_por` explícito para
 * corregir la derivación (lo hace `time-off-cascade-hook`, que escribe con
 * accountability de sistema pero sabe que la cancelación es "clinica").
 *
 * ES UN `filter`, NO UN `action`: así el estampado entra en el MISMO UPDATE que
 * el cambio de estado. Con un `action` habría una segunda escritura que puede
 * fallar por su cuenta y dejar citas canceladas sin fecha — justo el hueco que
 * este hook existe para tapar. Al revés que `force-password-change-hook`, que
 * tuvo que ser `action` porque su campo es deliberadamente no escribible por el
 * usuario.
 *
 * DEPENDE DE UN PERMISO: un `filter` corre ANTES de validar el payload contra
 * los permisos de campo de quien escribe, así que los tres campos deben estar
 * dentro del `fields` de la fila `appointments.update` de cada policy o el
 * usuario recibiría un 403 al cancelar. Se cumple porque todas usan
 * `fields: ["*"]` (ver scripts/provision-clinic-permissions.ts). Si alguna vez
 * se cambia a una lista explícita, hay que incluirlos.
 *
 * NO va dentro de `appointments-overlap-guard` (el otro filter sobre esta misma
 * colección) porque aquel retorna temprano justo para los estados no bloqueantes
 * — y `cancelada` es uno de ellos.
 */

const CANCELLED = "cancelada";

/** Debe coincidir con el dropdown de scripts/provision-cancellation-fields.ts. */
type CancelledBy = "paciente" | "recepcion" | "medico" | "clinica" | "admin";

interface AppointmentPayload {
  estado?: string;
  cancelado_en?: string | null;
  cancelado_por?: CancelledBy | null;
  motivo_cancelacion?: string | null;
}

interface Accountability {
  user?: string | null;
  role?: string | null;
  roles?: string[] | null;
  admin?: boolean;
}

/**
 * Nombre del rol de Directus -> valor de `cancelado_por`. El bot solo cancela
 * cuando el paciente se lo pide por WhatsApp, así que su rol mapea a "paciente":
 * lo que interesa al reporte es quién originó la cancelación, no qué software la
 * ejecutó.
 */
const ROLE_TO_CANCELLED_BY: Record<string, CancelledBy> = {
  Doctor: "medico",
  Receptionist: "recepcion",
  "Bot WhatsApp": "paciente",
};

export default defineHook(({ filter }, { services, database, getSchema }) => {
  const { ItemsService } = services;

  // Los roles casi nunca cambian de nombre, así que se cachean para no pegarle a
  // la base en cada cancelación. Contrapartida: renombrar un rol exige reiniciar
  // el contenedor de Directus para que este hook se entere.
  const roleNameCache = new Map<string, string | null>();

  async function roleName(roleId: string, schema: unknown): Promise<string | null> {
    const cached = roleNameCache.get(roleId);
    if (cached !== undefined) return cached;

    // accountability de sistema: `directus_roles` no es legible para todos los
    // roles, y el hook debe poder resolver el nombre igual.
    const roles = new ItemsService("directus_roles", { schema, accountability: null, knex: database });
    let name: string | null = null;
    try {
      const row = (await roles.readOne(roleId, { fields: ["name"] })) as { name?: string } | null;
      name = row?.name ?? null;
    } catch (err) {
      console.error(`[appointment-cancel-stamp-hook] No se pudo leer el rol ${roleId}:`, err);
    }
    roleNameCache.set(roleId, name);
    return name;
  }

  /**
   * Devuelve `null` cuando no se puede determinar el autor con confianza. Dejar
   * el campo vacío es preferible a inventarlo: el reporte muestra "sin dato",
   * que es honesto, en vez de atribuirle la cancelación a alguien que no fue.
   */
  async function deriveCancelledBy(
    accountability: Accountability | null | undefined,
    schema: unknown,
  ): Promise<CancelledBy | null> {
    // Sin accountability = escritura de sistema: otro hook (típicamente
    // `time-off-cascade-hook`, que cancela por ausencia del médico) o una tarea
    // interna. Es la clínica la que cancela, no el paciente.
    if (!accountability) return "clinica";
    if (accountability.admin) return "admin";

    const roleIds = [accountability.role, ...(accountability.roles ?? [])].filter(
      (r): r is string => typeof r === "string" && r.length > 0,
    );
    for (const roleId of roleIds) {
      const name = await roleName(roleId, schema);
      if (name && ROLE_TO_CANCELLED_BY[name]) return ROLE_TO_CANCELLED_BY[name]!;
    }
    return null;
  }

  async function stamp(
    payload: AppointmentPayload,
    context: { schema?: unknown; accountability?: Accountability | null },
  ): Promise<void> {
    const schema = context.schema ?? (await getSchema());

    if (payload.cancelado_en === undefined) {
      payload.cancelado_en = new Date().toISOString();
    }
    if (payload.cancelado_por === undefined) {
      const derived = await deriveCancelledBy(context.accountability, schema);
      // Solo se escribe si hay algo que escribir: mandar `null` explícito
      // borraría un valor previo en un re-guardado.
      if (derived) payload.cancelado_por = derived;
    }
  }

  filter<AppointmentPayload>("appointments.items.create", async (payload, _meta, context) => {
    // Caso raro (dar de alta una cita ya cancelada) pero barato de cubrir, y sin
    // lectura previa: en un create no hay estado anterior que consultar.
    if (payload.estado !== CANCELLED) return payload;
    await stamp(payload, context);
    return payload;
  });

  filter<AppointmentPayload>("appointments.items.update", async (payload, meta, context) => {
    if (payload.estado !== CANCELLED) return payload;

    const keys = (Array.isArray(meta.keys) ? meta.keys : [meta.keys]).filter(Boolean).map(String);
    if (keys.length === 0) return payload;

    // Sin esta comprobación, cualquier guardado posterior de una cita ya
    // cancelada (por ejemplo escribir el motivo un rato después, o marcar
    // `cancelacion_mensaje_enviado`) reenviaría `estado: "cancelada"` y pisaría
    // la fecha original con la de hoy — la anticipación del reporte se
    // desmoronaría en silencio.
    //
    // accountability de sistema por la misma razón que en
    // `appointments-overlap-guard`: una recepcionista puede no ver la cita de
    // otra sede, y la consulta volvería vacía haciendo creer que no está
    // cancelada.
    const appointments = new ItemsService("appointments", {
      schema: context.schema,
      accountability: null,
      knex: database,
    });
    const rows = (await appointments.readMany(keys, {
      filter: { estado: { _neq: CANCELLED } },
      limit: -1,
      fields: ["id"],
    })) as { id: string }[];

    // Todas las filas del lote ya estaban canceladas: no es una cancelación
    // nueva, no se toca nada.
    if (rows.length === 0) return payload;

    // Un `filter` tiene UN payload compartido por todas las claves del lote, así
    // que en un lote mixto (algunas ya canceladas, otras no) las ya canceladas
    // reciben la fecha nueva. En la práctica no ocurre: el panel cancela de a
    // una y la cascada por ausencia solo toca citas pendientes/confirmadas.
    await stamp(payload, context);
    return payload;
  });
});
