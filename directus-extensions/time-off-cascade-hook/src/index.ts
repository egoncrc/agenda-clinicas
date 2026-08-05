import { defineHook } from "@directus/extensions-sdk";

/**
 * Cuando se registra (o se amplía) una ausencia de un médico, las citas que ya
 * estaban agendadas dentro de ese rango pasan a `cancelada`. Sin esto, el
 * paciente se presenta a una consulta que nadie va a atender: la validación
 * entre citas y ausencias era unidireccional (el hook `appointments-overlap-guard`
 * impide agendar sobre una ausencia, pero nada impedía declarar una ausencia
 * sobre citas ya existentes).
 *
 * Es un `action` y no un `filter`, al revés que el guard: aquí no se rechaza la
 * escritura de la ausencia, se reacciona a ella modificando otras filas. Corre
 * después de escribir y no puede (ni debe) bloquear.
 *
 * La cascada se acota a la clínica de la ausencia (`time_off.clinic`): un
 * médico puede trabajar en varias y estar ausente solo en una, donde sus citas
 * se cancelan, mientras sigue atendiendo en las demás.
 *
 * El panel Vue hace lo mismo desde el cliente, con confirmación previa y el
 * detalle de a quién afecta. Este hook es la red de seguridad para todo lo que
 * no pasa por el panel (el admin de Directus, la API): es idempotente, así que
 * si el panel llegó primero simplemente no encuentra nada que cancelar.
 */

/** Estados que ocupan la agenda y que, por tanto, hay que liberar. `completada` no: ya se atendió. */
const CANCELABLE_STATUSES = ["pendiente", "confirmada"];

interface TimeOffRow {
  doctor?: string;
  inicio?: string;
  fin?: string;
  clinic?: string;
}

export default defineHook(({ action }, { services, database, getSchema }) => {
  const { ItemsService } = services;

  async function cancelAppointmentsInTimeOff(timeOffId: string): Promise<void> {
    const schema = await getSchema();

    // `accountability: null` = acceso de sistema, a propósito. Un médico puede
    // registrar su propia ausencia sin tener permiso de escritura sobre todas
    // las citas afectadas (la policy Doctor las filtra por `doctor.usuario`),
    // y la cascada tiene que completarse igual. El guard sí propaga el
    // accountability del usuario, pero porque solo lee.
    const timeOffService = new ItemsService("time_off", { schema, accountability: null, knex: database });
    const appointmentsService = new ItemsService("appointments", { schema, accountability: null, knex: database });

    const row = (await timeOffService.readOne(timeOffId, {
      fields: ["doctor", "inicio", "fin", "clinic"],
    })) as TimeOffRow | null;

    if (!row?.doctor || !row.inicio || !row.fin || !row.clinic) return;

    const clashes = (await appointmentsService.readByQuery({
      filter: {
        _and: [
          { doctor: { _eq: row.doctor } },
          // Solo la clínica donde se registró la ausencia. El servicio corre con
          // `accountability: null`, así que ve las citas del médico en TODAS sus
          // clínicas: sin este filtro cancelaría también las de las otras sedes,
          // donde el médico sigue atendiendo.
          { clinic: { _eq: row.clinic } },
          { estado: { _in: CANCELABLE_STATUSES } },
          // Solape estricto, mismo criterio que el guard: la cita empieza antes
          // de que acabe la ausencia y termina después de que empiece.
          { inicio: { _lt: row.fin } },
          { fin: { _gt: row.inicio } },
          // Solo futuras: una ausencia registrada a posteriori no debe reescribir
          // citas que ya ocurrieron.
          { inicio: { _gt: new Date().toISOString() } },
        ],
      },
      fields: ["id"],
      limit: -1,
    })) as Array<{ id: string }>;

    if (clashes.length === 0) return;

    // Con eventos (no se pasa `emitEvents: false`): el cambio debe llegar a
    // `waitlist-notify-hook`, porque cancelar libera cupos que la lista de
    // espera puede aprovechar. No hay recursión con `appointments-overlap-guard`:
    // `cancelada` no es un estado bloqueante, así que su filter retorna temprano.
    // Trazabilidad completa y explícita para el reporte de Cancelaciones, aunque
    // `appointment-cancel-stamp-hook` la estamparía igual: no depender de que la
    // otra extensión esté desplegada, y dejar dicho que quien canceló fue la
    // clínica en vez de confiar en que su derivación siga dando eso. El motivo no
    // lo puede adivinar nadie más que este hook.
    await appointmentsService.updateMany(
      clashes.map((a) => a.id),
      {
        estado: "cancelada",
        cancelada_por_ausencia: true,
        cancelado_en: new Date().toISOString(),
        cancelado_por: "clinica",
        motivo_cancelacion: "Ausencia del médico",
      },
    );

    console.log(
      `[time-off-cascade-hook] Ausencia ${timeOffId}: ${clashes.length} cita(s) canceladas.`,
    );
  }

  /** Un fallo aquí no debe propagarse: la ausencia ya está escrita y la petición ya respondió. */
  async function safeCascade(timeOffId: string): Promise<void> {
    try {
      await cancelAppointmentsInTimeOff(timeOffId);
    } catch (err) {
      console.error(`[time-off-cascade-hook] Error cancelando citas de la ausencia ${timeOffId}:`, err);
    }
  }

  action("time_off.items.create", (meta) => {
    void safeCascade(String(meta.key));
  });

  // Un update puede mover o ampliar el rango, así que hay que reevaluar; y puede
  // venir en lote (`keys`), no solo de una fila.
  action("time_off.items.update", (meta) => {
    const keys = Array.isArray(meta.keys) ? meta.keys : [meta.keys];
    for (const key of keys) {
      void safeCascade(String(key));
    }
  });
});
