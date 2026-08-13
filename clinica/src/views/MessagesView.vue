<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { createItem, readItems, updateItem } from "@directus/sdk";
import { DateTime } from "luxon";
import { directus } from "@/lib/directus";
import type { AppointmentRow, PatientRow, ServiceRow } from "@/lib/directus";
import { useCatalogStore } from "@/stores/catalog";
import { useClinicaStore } from "@/stores/clinica";
import { CLINIC_TIMEZONE, formatDay, formatTime, formatTime12h, now, toIsoOrThrow } from "@/lib/dateRanges";
import { dateRangeFilter } from "@/lib/queryHelpers";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { computeRecallItems, recallKey, RECALL_MAX_OVERDUE_MONTHS, type RecallItem } from "@/lib/recall";
import { bookingLink, buildCancellationMessage, buildConfirmationMessage, buildRecallMessage, waMeLink } from "@/lib/messageTemplates";
import { useCopyToClipboard } from "@/composables/useCopyToClipboard";
import Badge from "@/components/ui/Badge.vue";
import Button from "@/components/ui/Button.vue";
import EmptyState from "@/components/ui/EmptyState.vue";

/**
 * Pantalla de trabajo de la recepción mientras la cuenta de WhatsApp Business está
 * bloqueada: arma la lista de a quién hay que contactar, redacta el texto y lleva
 * la cuenta de qué ya se envió. El envío ocurre fuera del sistema (llamada, SMS o
 * el WhatsApp personal de la recepcionista vía wa.me).
 */

/** Más lento que los 15s de la agenda: nada aquí es urgente al segundo y cada ciclo son varias consultas. */
const POLL_INTERVAL_MS = 60_000;

/**
 * Cuántos días atrás se siguen mostrando las cancelaciones. La cita ya no va a
 * ocurrir, así que el margen es solo para no perder un aviso pendiente de una
 * ausencia registrada hace unos días; más atrás, avisar ya no sirve de nada.
 */
const CANCELLATION_LOOKBACK_DAYS = 7;

const BADGE_TONE_BY_KIND = {
  confirmacion: "warn",
  recall: "info",
  cancelacion: "danger",
} as const;

/** Flag de `appointments` que marca cada tipo de mensaje como ya enviado a mano. */
const FLAG_BY_KIND = {
  confirmacion: "confirmacion_manual_enviada",
  recall: "recall_mensaje_enviado",
  cancelacion: "cancelacion_mensaje_enviado",
} as const;

const catalog = useCatalogStore();
const clinica = useClinicaStore();
const { copiedKey, copyError, copy } = useCopyToClipboard();

const tab = ref<"confirmaciones" | "recall" | "cancelaciones">("confirmaciones");
/** Por defecto mañana: es el día que la recepción confirma. */
const dateFilter = ref(now().plus({ days: 1 }).toFormat("yyyy-LL-dd"));
/** Permite volver a ver (y desmarcar) lo ya enviado, para deshacer un clic accidental. */
const showSent = ref(false);

const pendingAppointments = ref<AppointmentRow[]>([]);
const recallRaw = ref<RecallItem[]>([]);
const cancelledAppointments = ref<AppointmentRow[]>([]);
const patientsById = ref<Record<string, Pick<PatientRow, "id" | "nombre" | "telefono">>>({});

const loading = ref(true);
const error = ref<string | null>(null);
const savingKey = ref<string | null>(null);

const clinicaNombre = computed(() => clinica.activeClinic?.nombre ?? "la clínica");

interface MessageItem {
  key: string;
  kind: keyof typeof FLAG_BY_KIND;
  appointmentId: string;
  patientId: string;
  pacienteNombre: string | null;
  telefono: string | null;
  servicioNombre: string;
  /** Etiqueta del Badge: fecha·hora de la cita, o el vencimiento del seguimiento. */
  badgeTexto: string;
  /** Línea secundaria bajo el nombre. */
  detalle: string;
  mensaje: string;
  waLink: string | null;
  /** true cuando la fila ya está marcada como enviada (solo visible con `showSent`). */
  yaEnviado: boolean;
}

/** "12 de enero", sin día de la semana (formatDay sí lo incluye). */
function fechaCorta(iso: string): string {
  return DateTime.fromISO(iso, { zone: CLINIC_TIMEZONE }).setLocale("es").toFormat("d 'de' LLLL");
}

function paciente(id: string): Pick<PatientRow, "id" | "nombre" | "telefono"> | undefined {
  return patientsById.value[id];
}

// Los textos se derivan en computed en vez de guardarse: si cambia el nombre del
// paciente o del servicio se regeneran solos, y no hay estado que sincronizar.
const confirmationItems = computed<MessageItem[]>(() =>
  pendingAppointments.value.map((a) => {
    const p = paciente(a.patient);
    const pacienteNombre = p?.nombre?.trim() || null;
    const servicioNombre = catalog.serviceName(a.service);
    const inicio = new Date(a.inicio);
    const mensaje = buildConfirmationMessage({
      clinicaNombre: clinicaNombre.value,
      pacienteNombre,
      servicioNombre,
      doctorNombre: catalog.doctorName(a.doctor),
      fechaTexto: formatDay(inicio),
      horaTexto: formatTime12h(inicio),
      telefonoContacto: clinica.activeClinic?.telefono_contacto ?? "",
    });
    return {
      key: `conf:${a.id}`,
      kind: "confirmacion",
      appointmentId: a.id,
      patientId: a.patient,
      pacienteNombre,
      telefono: p?.telefono ?? null,
      servicioNombre,
      badgeTexto: `${formatTime(inicio)} · ${formatDay(inicio)}`,
      detalle: `${servicioNombre} · ${catalog.doctorName(a.doctor)}`,
      mensaje,
      waLink: waMeLink(p?.telefono, mensaje),
      yaEnviado: a.confirmacion_manual_enviada === true,
    };
  }),
);

const recallItems = computed<MessageItem[]>(() =>
  recallRaw.value.map((r) => {
    const p = paciente(r.patientId);
    const pacienteNombre = p?.nombre?.trim() || null;
    const servicioNombre = catalog.serviceName(r.serviceId);
    const mensaje = buildRecallMessage({
      clinicaNombre: clinicaNombre.value,
      pacienteNombre,
      servicioNombre,
      recallMeses: r.recallMeses,
      ultimaVisitaTexto: fechaCorta(r.ultimaCitaIso),
    });
    const dias = r.diasParaVencer;
    return {
      key: `recall:${r.appointmentId}`,
      kind: "recall",
      appointmentId: r.appointmentId,
      patientId: r.patientId,
      pacienteNombre,
      telefono: p?.telefono ?? null,
      servicioNombre,
      badgeTexto: dias >= 0 ? `Vence en ${dias} d` : `Vencido hace ${Math.abs(dias)} d`,
      detalle: `${servicioNombre} · última visita ${fechaCorta(r.ultimaCitaIso)}`,
      mensaje,
      waLink: waMeLink(p?.telefono, mensaje),
      yaEnviado: false,
    };
  }),
);

const cancellationItems = computed<MessageItem[]>(() =>
  cancelledAppointments.value.map((a) => {
    const p = paciente(a.patient);
    const pacienteNombre = p?.nombre?.trim() || null;
    const servicioNombre = catalog.serviceName(a.service);
    const inicio = new Date(a.inicio);
    const mensaje = buildCancellationMessage({
      clinicaNombre: clinicaNombre.value,
      pacienteNombre,
      servicioNombre,
      doctorNombre: catalog.doctorName(a.doctor),
      fechaTexto: formatDay(inicio),
      horaTexto: formatTime12h(inicio),
      telefonoContacto: clinica.activeClinic?.telefono_contacto ?? "",
      enlaceAgendar: bookingLink(clinica.activeClinicId ?? ""),
    });
    return {
      key: `cancel:${a.id}`,
      kind: "cancelacion",
      appointmentId: a.id,
      patientId: a.patient,
      pacienteNombre,
      telefono: p?.telefono ?? null,
      servicioNombre,
      badgeTexto: `${formatTime(inicio)} · ${formatDay(inicio)}`,
      detalle: `${servicioNombre} · ${catalog.doctorName(a.doctor)}`,
      mensaje,
      waLink: waMeLink(p?.telefono, mensaje),
      yaEnviado: a.cancelacion_mensaje_enviado === true,
    };
  }),
);

const visibleItems = computed(() => {
  if (tab.value === "confirmaciones") return confirmationItems.value;
  if (tab.value === "recall") return recallItems.value;
  return cancellationItems.value;
});

const EMPTY_TEXTS = {
  confirmaciones: {
    title: "No hay citas pendientes por confirmar",
    description: "Pruebe con otra fecha, o marque la casilla para ver los mensajes ya enviados.",
  },
  recall: {
    title: "Nadie por contactar para seguimiento",
    description:
      "Aparecerán aquí los pacientes que estén por cumplir el plazo desde su última visita. Requiere que el servicio tenga configurados los meses de seguimiento.",
  },
  cancelaciones: {
    title: "No hay cancelaciones por avisar",
    description:
      "Aparecerán aquí las citas que se cancelaron solas al registrar una suspensión del médico, para avisar al paciente.",
  },
} as const;

const emptyTitle = computed(() => EMPTY_TEXTS[tab.value].title);
const emptyDescription = computed(() => EMPTY_TEXTS[tab.value].description);

/** Evita solapar una recarga (poll, filtro, guardado) con otra ya en curso. */
let loadInFlight = false;

/** Consulta 1: citas pendientes del día elegido que todavía no se han confirmado a mano. */
async function fetchConfirmations(): Promise<AppointmentRow[]> {
  const day = DateTime.fromFormat(dateFilter.value, "yyyy-LL-dd", { zone: CLINIC_TIMEZONE });
  if (!day.isValid) return [];

  const filter: Record<string, unknown> = {
    clinic: { _eq: clinica.activeClinicId ?? undefined },
    estado: { _eq: "pendiente" },
    inicio: dateRangeFilter(toIsoOrThrow(day.startOf("day")), toIsoOrThrow(day.endOf("day"))),
  };
  if (!showSent.value) {
    // `_null` además de `_eq: false`: las citas creadas antes de que existiera la
    // columna pueden traer NULL en vez de false.
    filter._or = [
      { confirmacion_manual_enviada: { _eq: false } },
      { confirmacion_manual_enviada: { _null: true } },
    ];
  }

  return directus.request(readItems("appointments", { filter, sort: ["inicio"], limit: -1 }));
}

/** Consultas 2 y 3: histórico acotado de citas completadas + citas futuras que suprimen el recall. */
async function fetchRecall(): Promise<RecallItem[]> {
  const recallServices = catalog.services.filter(
    (s): s is ServiceRow & { recall_meses: number } =>
      typeof s.recall_meses === "number" && s.recall_meses > 0,
  );
  if (recallServices.length === 0) return [];

  const recallServiceIds = recallServices.map((s) => s.id);
  const recallMesesByService = Object.fromEntries(recallServices.map((s) => [s.id, s.recall_meses]));
  const maxRecallMeses = Math.max(...recallServices.map((s) => s.recall_meses));

  const nowDt = now();
  const desde = nowDt.minus({ months: maxRecallMeses + RECALL_MAX_OVERDUE_MONTHS });

  const [completadas, futuras] = await Promise.all([
    // El límite superior es `now`, no `now - recallMeses`: acotarlo más ocultaría
    // las citas recientes que invalidan a una vieja (ver recall.ts).
    directus.request(
      readItems("appointments", {
        filter: {
          clinic: { _eq: clinica.activeClinicId ?? undefined },
          estado: { _eq: "completada" },
          service: { _in: recallServiceIds },
          inicio: dateRangeFilter(toIsoOrThrow(desde), toIsoOrThrow(nowDt)),
        },
        fields: ["id", "patient", "service", "inicio", "recall_mensaje_enviado"],
        sort: ["-inicio"],
        limit: -1,
      }),
    ),
    directus.request(
      readItems("appointments", {
        filter: {
          clinic: { _eq: clinica.activeClinicId ?? undefined },
          estado: { _in: ["pendiente", "confirmada"] },
          service: { _in: recallServiceIds },
          inicio: dateRangeFilter(toIsoOrThrow(nowDt)),
        },
        fields: ["patient", "service"],
        limit: -1,
      }),
    ),
  ]);

  const futurasKeys = new Set(futuras.map((a) => recallKey(a.patient, a.service)));
  return computeRecallItems({ completadas, recallMesesByService, futurasKeys, now: nowDt });
}

/**
 * Consulta 4: citas que una ausencia del médico canceló automáticamente y cuyo
 * paciente todavía no ha sido avisado. Solo esas: una cita que la recepción
 * canceló de común acuerdo por teléfono no necesita aviso, y por eso el hook y
 * el panel marcan `cancelada_por_ausencia` al cancelar en cascada.
 */
async function fetchCancellations(): Promise<AppointmentRow[]> {
  const filter: Record<string, unknown> = {
    clinic: { _eq: clinica.activeClinicId ?? undefined },
    cancelada_por_ausencia: { _eq: true },
    // El flag se queda puesto aunque la cita se reactive (la recepción la vuelve a
    // poner `pendiente` tras reagendarla), así que hay que mirar también el estado:
    // avisar de una cancelación que ya se deshizo confundiría al paciente.
    estado: { _eq: "cancelada" },
    inicio: dateRangeFilter(toIsoOrThrow(now().minus({ days: CANCELLATION_LOOKBACK_DAYS }))),
  };
  if (!showSent.value) {
    filter._or = [
      { cancelacion_mensaje_enviado: { _eq: false } },
      { cancelacion_mensaje_enviado: { _null: true } },
    ];
  }

  return directus.request(readItems("appointments", { filter, sort: ["inicio"], limit: -1 }));
}

/** Nombre y teléfono de los pacientes de las tres listas, en una sola consulta. */
async function loadPatients(ids: string[]): Promise<void> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) {
    patientsById.value = {};
    return;
  }
  const rows = await directus.request(
    readItems("patients", {
      filter: { id: { _in: unicos } },
      fields: ["id", "nombre", "telefono"],
      limit: -1, // sin esto Directus corta en 100
    }),
  );
  patientsById.value = Object.fromEntries(rows.map((p) => [p.id, p]));
}

/** `silent`: no toca `loading`, para que el polling no haga parpadear la lista. */
async function load(opts: { silent?: boolean } = {}): Promise<void> {
  if (loadInFlight) return;
  loadInFlight = true;
  if (!opts.silent) loading.value = true;
  error.value = null;
  try {
    await catalog.load();

    const [confirmaciones, recall, canceladas] = await Promise.all([
      fetchConfirmations(),
      fetchRecall(),
      fetchCancellations(),
    ]);
    pendingAppointments.value = confirmaciones;
    recallRaw.value = recall;
    cancelledAppointments.value = canceladas;

    await loadPatients([
      ...confirmaciones.map((a) => a.patient),
      ...recall.map((r) => r.patientId),
      ...canceladas.map((a) => a.patient),
    ]);
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudieron cargar los mensajes.");
  } finally {
    if (!opts.silent) loading.value = false;
    loadInFlight = false;
  }
}

async function markSent(item: MessageItem): Promise<void> {
  if (savingKey.value) return;
  savingKey.value = item.key;
  error.value = null;
  try {
    // Primero el registro en `messages`: si esto falla (p. ej. falta el permiso
    // `create`), el flag NO se pone y el ítem sigue en la lista, así la recepción
    // ve el error y reintenta en vez de que desaparezca sin dejar rastro.
    await directus.request(
      createItem("messages", {
        patient: item.patientId,
        direccion: "out",
        contenido: item.mensaje,
        wa_message_id: null, // no pasó por la API de Meta
      }),
    );
    await directus.request(
      updateItem("appointments", item.appointmentId, { [FLAG_BY_KIND[item.kind]]: true }),
    );
    // Quitado optimista: la consulta ya filtra por el flag, así que el siguiente
    // poll no lo trae de vuelta. Con `showSent` activo sí conviene recargar, para
    // que la tarjeta se quede a la vista pero con el botón invertido.
    if (showSent.value) {
      await load({ silent: true });
    } else if (item.kind === "confirmacion") {
      pendingAppointments.value = pendingAppointments.value.filter((a) => a.id !== item.appointmentId);
    } else if (item.kind === "cancelacion") {
      cancelledAppointments.value = cancelledAppointments.value.filter((a) => a.id !== item.appointmentId);
    } else {
      recallRaw.value = recallRaw.value.filter((r) => r.appointmentId !== item.appointmentId);
    }
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo marcar el mensaje como enviado.");
  } finally {
    savingKey.value = null;
  }
}

/** Deshace un "Enviado" marcado por error. Solo alcanzable con `showSent` activo. */
async function markUnsent(item: MessageItem): Promise<void> {
  if (savingKey.value) return;
  savingKey.value = item.key;
  error.value = null;
  try {
    await directus.request(
      updateItem("appointments", item.appointmentId, { [FLAG_BY_KIND[item.kind]]: false }),
    );
    await load({ silent: true });
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudo desmarcar el mensaje.");
  } finally {
    savingKey.value = null;
  }
}

let pollTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  void load();
  pollTimer = setInterval(() => void load({ silent: true }), POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

watch([dateFilter, showSent], () => void load());
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="font-display text-xl font-bold text-brand-800">Mensajes</h1>
      <p class="mt-1 text-sm text-slate-500">
        Textos listos para copiar y enviar a mano por llamada, mensaje o WhatsApp.
      </p>
    </div>

    <div class="mb-4 inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
      <button
        type="button"
        class="rounded-md px-3 py-1.5 text-xs font-medium transition"
        :class="tab === 'confirmaciones' ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50'"
        @click="tab = 'confirmaciones'"
      >
        Confirmaciones ({{ confirmationItems.length }})
      </button>
      <button
        type="button"
        class="rounded-md px-3 py-1.5 text-xs font-medium transition"
        :class="tab === 'recall' ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50'"
        @click="tab = 'recall'"
      >
        Seguimiento ({{ recallItems.length }})
      </button>
      <button
        type="button"
        class="rounded-md px-3 py-1.5 text-xs font-medium transition"
        :class="tab === 'cancelaciones' ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50'"
        @click="tab = 'cancelaciones'"
      >
        Cancelaciones ({{ cancellationItems.length }})
      </button>
    </div>

    <div v-if="tab !== 'recall'" class="mb-4 flex flex-wrap items-center gap-3">
      <label v-if="tab === 'confirmaciones'" class="flex items-center gap-2 text-sm text-slate-600">
        <span>Citas del</span>
        <input
          v-model="dateFilter"
          type="date"
          class="rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
      </label>
      <label class="flex items-center gap-2 text-sm text-slate-600">
        <input v-model="showSent" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-brand-600" />
        Ver también los ya enviados
      </label>
    </div>

    <div v-if="copyError" class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {{ copyError }}
    </div>
    <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>

    <EmptyState v-else-if="visibleItems.length === 0" :title="emptyTitle" :description="emptyDescription" />

    <div v-else class="space-y-3">
      <article
        v-for="item in visibleItems"
        :key="item.key"
        class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-slate-800">
              {{ item.pacienteNombre ?? "(sin nombre)" }}
            </p>
            <p class="text-xs tabular-nums text-slate-500">{{ item.telefono ?? "(sin teléfono)" }}</p>
          </div>
          <Badge :tone="BADGE_TONE_BY_KIND[item.kind]">{{ item.badgeTexto }}</Badge>
        </div>

        <p class="mt-1 text-xs text-slate-500">{{ item.detalle }}</p>

        <p class="mt-3 whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{{ item.mensaje }}</p>

        <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="secondary" @click="copy(item.mensaje, item.key)">
            {{ copiedKey === item.key ? "¡Copiado!" : "Copiar" }}
          </Button>

          <a
            v-if="item.waLink"
            :href="item.waLink"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
          >
            WhatsApp
          </a>
          <span v-else class="text-xs text-amber-600" title="Teléfono incompleto o inválido">Sin WhatsApp</span>

          <Button
            v-if="item.yaEnviado"
            size="sm"
            variant="secondary"
            :loading="savingKey === item.key"
            @click="markUnsent(item)"
          >
            Marcar como no enviado
          </Button>
          <Button v-else size="sm" :loading="savingKey === item.key" @click="markSent(item)">
            Enviado
          </Button>
        </div>
      </article>
    </div>
  </div>
</template>
