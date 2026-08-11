import { defineHook } from "@directus/extensions-sdk";
import { ForbiddenError } from "@directus/errors";

/**
 * Dos reglas sobre `working_hours` que antes no existían en ninguna capa:
 *
 * 1. **Anti-superposición** (`filter`, rechaza la escritura). Un médico no puede
 *    tener dos bloques que se pisen el mismo día. La comprobación es
 *    CROSS-CLÍNICA por la misma razón que el solape de citas: un médico no puede
 *    estar en dos sedes a la vez, así que lunes 08–11 en la clínica A y lunes
 *    10–12 en la B es imposible aunque cada fila mire a una clínica distinta.
 *    Bloques contiguos (08–11 y 11–13) sí son válidos: los intervalos son
 *    semiabiertos.
 *
 * 2. **Cascada de cancelación** (`filter` que fotografía + `action` que cancela).
 *    Al recortar, mover o borrar un bloque, las citas que caían en el tramo que
 *    desaparece se quedan sin médico. Pasan a `cancelada` con
 *    `cancelada_por_ausencia: true`, que es lo que las hace aparecer en la
 *    pestaña "Cancelaciones" de la pantalla Mensajes para avisar al paciente.
 *
 * Por qué la cascada necesita las dos mitades: un `action` corre DESPUÉS de la
 * escritura, cuando el horario anterior ya no existe y no hay contra qué
 * comparar. Así que el `filter` fotografía el horario del médico antes de
 * escribir y el `action` calcula la diferencia contra el estado ya guardado. La
 * cancelación tiene que ser un `action` (muta otras filas y no debe poder tumbar
 * la escritura del horario), igual que `time-off-cascade-hook`.
 *
 * Solo se cancela lo que pisa el tramo que DESAPARECE, no todo lo que quede
 * fuera del horario: una cita agendada a mano fuera de la agenda ya estaba
 * fuera antes del cambio, y no es este cambio el que la rompe.
 *
 * El panel Vue hace lo mismo desde el cliente, con confirmación previa y el
 * detalle de a quién afecta. Este hook es la red de seguridad para todo lo que
 * no pasa por el panel (el admin de Directus, la API): es idempotente, así que
 * si el panel llegó primero simplemente no encuentra nada que cancelar.
 */

/** Estados que ocupan la agenda y que, por tanto, hay que liberar. `completada` no: ya se atendió. */
const CANCELABLE_STATUSES = ["pendiente", "confirmada"];

/**
 * `working_hours.hora_inicio`/`hora_fin` son horas sin zona; `appointments.inicio`
 * es un instante. Para saber en qué día y hora local cae una cita hace falta la
 * zona de la clínica — la misma que usa el bot (`CLINIC_TIMEZONE` en src/config.ts).
 */
const TIMEZONE = process.env.CLINIC_TIMEZONE || "America/Costa_Rica";

/** Cuánto se conserva una foto huérfana (la escritura falló y su `action` nunca corrió). */
const SNAPSHOT_TTL_MS = 30_000;

interface HoursRow {
  id?: string | number;
  doctor?: string;
  clinic?: string;
  dia_semana?: number;
  hora_inicio?: string;
  hora_fin?: string;
}

interface MinuteRange {
  inicio: number;
  fin: number;
}

/** Acepta "HH:mm" y "HH:mm:ss" (lo que devuelve Directus para un campo `time`). */
function hhmmToMin(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

function toRange(row: HoursRow): MinuteRange | null {
  if (!row.hora_inicio || !row.hora_fin) return null;
  const inicio = hhmmToMin(row.hora_inicio);
  const fin = hhmmToMin(row.hora_fin);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return null;
  return { inicio, fin };
}

/** Unión normalizada: ordenada, sin solapes y con los contiguos fundidos. */
function mergeRanges(ranges: MinuteRange[]): MinuteRange[] {
  const ordenados = ranges.filter((r) => r.fin > r.inicio).sort((a, b) => a.inicio - b.inicio);
  const out: MinuteRange[] = [];
  for (const r of ordenados) {
    const last = out[out.length - 1];
    if (last && r.inicio <= last.fin) last.fin = Math.max(last.fin, r.fin);
    else out.push({ ...r });
  }
  return out;
}

/** `before` menos `after`. */
function subtractRanges(before: MinuteRange[], after: MinuteRange[]): MinuteRange[] {
  const restar = mergeRanges(after);
  const out: MinuteRange[] = [];
  for (const base of mergeRanges(before)) {
    let cursor = base.inicio;
    for (const r of restar) {
      if (r.fin <= cursor) continue;
      if (r.inicio >= base.fin) break;
      if (r.inicio > cursor) out.push({ inicio: cursor, fin: Math.min(r.inicio, base.fin) });
      cursor = Math.max(cursor, r.fin);
      if (cursor >= base.fin) break;
    }
    if (cursor < base.fin) out.push({ inicio: cursor, fin: base.fin });
  }
  return out;
}

function unionByDay(rows: HoursRow[]): Map<number, MinuteRange[]> {
  const porDia = new Map<number, MinuteRange[]>();
  for (const row of rows) {
    const r = toRange(row);
    if (!r || !row.dia_semana) continue;
    const acc = porDia.get(row.dia_semana);
    if (acc) acc.push(r);
    else porDia.set(row.dia_semana, [r]);
  }
  for (const [dia, ranges] of porDia) porDia.set(dia, mergeRanges(ranges));
  return porDia;
}

function removedByDay(before: HoursRow[], after: HoursRow[]): Map<number, MinuteRange[]> {
  const antes = unionByDay(before);
  const despues = unionByDay(after);
  const out = new Map<number, MinuteRange[]>();
  for (const [dia, ranges] of antes) {
    const eliminados = subtractRanges(ranges, despues.get(dia) ?? []);
    if (eliminados.length > 0) out.set(dia, eliminados);
  }
  return out;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Día ISO de la semana (1=lunes) y minutos desde medianoche, en la zona de la clínica. */
function localDayAndMinutes(iso: string): { dia: number; minutos: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const dia = WEEKDAY_INDEX[get("weekday")];
  if (!dia) return null;
  return { dia, minutos: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** ¿La cita pisa alguno de los tramos que desaparecen? Un solape parcial cuenta. */
function hitsRemoved(inicio: string, fin: string, removed: Map<number, MinuteRange[]>): boolean {
  const desde = localDayAndMinutes(inicio);
  const hasta = localDayAndMinutes(fin);
  if (!desde || !hasta) return false;
  const ranges = removed.get(desde.dia);
  if (!ranges) return false;
  // Una cita que cruzara la medianoche se recorta al final del día: el horario
  // laboral no puede describir el tramo del día siguiente.
  const finMin = hasta.dia === desde.dia ? hasta.minutos : 24 * 60;
  if (finMin <= desde.minutos) return false;
  return ranges.some((r) => desde.minutos < r.fin && r.inicio < finMin);
}

export default defineHook(({ filter, action }, { services, database, getSchema }) => {
  const { ItemsService } = services;

  /**
   * Horario de un médico en una clínica, tal como estaba justo antes de la
   * escritura. La clave es `doctor|clinic` porque es la unidad que la cascada
   * evalúa (el horario es por sede).
   *
   * Dos escrituras simultáneas sobre el mismo médico y clínica podrían pisarse
   * la foto; el panel hace su propia cascada de todos modos, y el peor caso es
   * que este hook no encuentre nada que cancelar.
   */
  const snapshots = new Map<string, { at: number; rows: HoursRow[] }>();

  function purgeStaleSnapshots(): void {
    const limite = Date.now() - SNAPSHOT_TTL_MS;
    for (const [key, value] of snapshots) {
      if (value.at < limite) snapshots.delete(key);
    }
  }

  function hoursService(schema: unknown) {
    // `accountability: null` = acceso de sistema, a propósito. Con el del
    // usuario, una recepcionista de la clínica A no ve el bloque que el médico
    // tiene en la B: la consulta de superposiciones volvería vacía y el choque
    // entre sedes pasaría sin que nada lo detenga. Mismo criterio que
    // `appointments-overlap-guard`.
    return new ItemsService("working_hours", { schema, accountability: null, knex: database });
  }

  async function readBlocks(schema: unknown, doctor: string, clinic: string): Promise<HoursRow[]> {
    return (await hoursService(schema).readByQuery({
      filter: { _and: [{ doctor: { _eq: doctor } }, { clinic: { _eq: clinic } }] },
      fields: ["id", "doctor", "clinic", "dia_semana", "hora_inicio", "hora_fin"],
      limit: -1,
    })) as HoursRow[];
  }

  /** Rechaza el bloque si se superpone con otro del mismo médico, en cualquier clínica. */
  async function assertNoOverlap(payload: HoursRow, existingId: string | null, schema: unknown): Promise<void> {
    const service = hoursService(schema);

    let { doctor, dia_semana, hora_inicio, hora_fin } = payload;

    // En un update el payload puede venir parcial: se completa con la fila actual.
    if (existingId && (!doctor || !dia_semana || !hora_inicio || !hora_fin)) {
      const current = (await service.readOne(existingId, {
        fields: ["doctor", "dia_semana", "hora_inicio", "hora_fin"],
      })) as HoursRow | null;
      doctor = doctor ?? current?.doctor;
      dia_semana = dia_semana ?? current?.dia_semana;
      hora_inicio = hora_inicio ?? current?.hora_inicio;
      hora_fin = hora_fin ?? current?.hora_fin;
    }

    if (!doctor || !dia_semana || !hora_inicio || !hora_fin) return;

    const candidato = toRange({ hora_inicio, hora_fin });
    if (!candidato) {
      throw new ForbiddenError({ reason: "La hora de fin del horario debe ser posterior a la de inicio." });
    }

    const hermanos = (await service.readByQuery({
      filter: {
        _and: [
          { doctor: { _eq: doctor } },
          { dia_semana: { _eq: dia_semana } },
          ...(existingId ? [{ id: { _neq: existingId } }] : []),
        ],
      },
      fields: ["hora_inicio", "hora_fin"],
      limit: -1,
    })) as HoursRow[];

    const choque = hermanos.some((h) => {
      const r = toRange(h);
      return r !== null && candidato.inicio < r.fin && r.inicio < candidato.fin;
    });

    if (choque) {
      // El mensaje no dice en qué clínica está el bloque rival: quien edita
      // puede ser de otra sede y no debe ver datos de un tenant ajeno.
      throw new ForbiddenError({
        reason: "El horario se superpone con otro bloque del mismo médico.",
      });
    }
  }

  /** Fotografía el horario de cada médico/clínica que la escritura va a tocar. */
  async function snapshotAffected(keys: string[], payload: HoursRow, schema: unknown): Promise<void> {
    purgeStaleSnapshots();
    const service = hoursService(schema);
    const pares = new Set<string>();

    for (const key of keys) {
      const row = (await service.readOne(String(key), { fields: ["doctor", "clinic"] })) as HoursRow | null;
      if (!row?.doctor || !row.clinic) continue;
      pares.add(`${row.doctor}|${row.clinic}`);
      // Mover el bloque a otro médico o a otra clínica vacía el horario de origen
      // y llena el de destino: hay que mirar los dos.
      pares.add(`${payload.doctor ?? row.doctor}|${payload.clinic ?? row.clinic}`);
    }

    for (const par of pares) {
      if (snapshots.has(par)) continue;
      const [doctor, clinic] = par.split("|");
      snapshots.set(par, { at: Date.now(), rows: await readBlocks(schema, doctor!, clinic!) });
    }
  }

  /** Cancela las citas futuras que caen en el horario que dejó de existir. */
  async function cascade(doctor: string, clinic: string, before: HoursRow[]): Promise<void> {
    const schema = await getSchema();
    const after = await readBlocks(schema, doctor, clinic);
    const removed = removedByDay(before, after);
    if (removed.size === 0) return;

    // `accountability: null`: un médico puede cambiar su propio horario sin tener
    // permiso de escritura sobre todas las citas afectadas, y la cascada tiene
    // que completarse igual (mismo criterio que `time-off-cascade-hook`).
    const appointmentsService = new ItemsService("appointments", {
      schema,
      accountability: null,
      knex: database,
    });

    // El criterio fino es "día de la semana + hora del día", que no se puede
    // expresar como filtro sobre `inicio`: se trae la agenda futura del médico
    // en esa clínica y se filtra en código.
    const futuras = (await appointmentsService.readByQuery({
      filter: {
        _and: [
          { doctor: { _eq: doctor } },
          // Solo esta sede: el horario es por clínica y el médico sigue
          // atendiendo en las demás donde trabaje.
          { clinic: { _eq: clinic } },
          { estado: { _in: CANCELABLE_STATUSES } },
          // Solo futuras: recortar el horario hoy no reescribe lo ya ocurrido.
          { inicio: { _gt: new Date().toISOString() } },
        ],
      },
      fields: ["id", "inicio", "fin"],
      limit: -1,
    })) as Array<{ id: string; inicio: string; fin: string }>;

    const afectadas = futuras.filter((a) => hitsRemoved(a.inicio, a.fin, removed));
    if (afectadas.length === 0) return;

    // Con eventos (no se pasa `emitEvents: false`): cancelar libera cupos que
    // `waitlist-notify-hook` puede aprovechar. No hay recursión con
    // `appointments-overlap-guard`: `cancelada` no es un estado bloqueante.
    await appointmentsService.updateMany(
      afectadas.map((a) => a.id),
      {
        estado: "cancelada",
        cancelada_por_ausencia: true,
        cancelado_en: new Date().toISOString(),
        cancelado_por: "clinica",
        motivo_cancelacion: "Cambio de horario del médico",
      },
    );

    console.log(
      `[working-hours-guard] Médico ${doctor} en clínica ${clinic}: ${afectadas.length} cita(s) canceladas por cambio de horario.`,
    );
  }

  /**
   * Consume todas las fotos pendientes. No se pueden acotar a las filas de esta
   * petición: en un delete la fila ya no existe cuando corre el `action`. Evaluar
   * una foto de más es inofensivo — si no falta ningún tramo, no cancela nada.
   */
  async function drainSnapshots(): Promise<void> {
    const pendientes = [...snapshots.entries()];
    snapshots.clear();
    for (const [par, { rows }] of pendientes) {
      const [doctor, clinic] = par.split("|");
      try {
        await cascade(doctor!, clinic!, rows);
      } catch (err) {
        // Un fallo aquí no debe propagarse: el horario ya está escrito y la
        // petición ya respondió.
        console.error(`[working-hours-guard] Error cancelando citas de ${par}:`, err);
      }
    }
  }

  filter<HoursRow>("working_hours.items.create", async (payload, _meta, context) => {
    await assertNoOverlap(payload, null, context.schema);
    return payload;
  });

  filter<HoursRow>("working_hours.items.update", async (payload, meta, context) => {
    const keys = (Array.isArray(meta.keys) ? meta.keys : [meta.keys]).map(String);
    for (const key of keys) {
      await assertNoOverlap(payload, key, context.schema);
    }
    // Después de validar: si la escritura se rechaza, no queda ninguna foto suelta.
    await snapshotAffected(keys, payload, context.schema);
    return payload;
  });

  // En un delete el payload ES la lista de claves.
  filter("working_hours.items.delete", async (payload, _meta, context) => {
    const keys = (Array.isArray(payload) ? payload : [payload]).map(String);
    await snapshotAffected(keys, {}, context.schema);
    return payload;
  });

  action("working_hours.items.update", () => {
    void drainSnapshots();
  });

  action("working_hours.items.delete", () => {
    void drainSnapshots();
  });
});
