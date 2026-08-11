<script setup lang="ts">
/**
 * Próximas citas de un paciente, de solo lectura: recepción lo abre desde la
 * ficha para saber qué tiene agendado sin salir a /citas y filtrar a mano.
 * Solo `pendiente`/`confirmada` de hoy en adelante — lo cancelado y lo ya
 * atendido no es lo que se está por consultar.
 */
import { onMounted, ref } from "vue";
import { readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { AppointmentRow, PatientRow } from "@/lib/directus";
import { ESTADO_LABELS, ESTADO_TONE } from "@/lib/appointmentStatus";
import { formatDay, formatTime, now, toIsoOrThrow } from "@/lib/dateRanges";
import { dateCompareFilter } from "@/lib/queryHelpers";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useClinicaStore } from "@/stores/clinica";
import Badge from "@/components/ui/Badge.vue";
import Button from "@/components/ui/Button.vue";
import EmptyState from "@/components/ui/EmptyState.vue";

const props = defineProps<{ patient: PatientRow }>();
const emit = defineEmits<{ close: [] }>();

interface CitaFila {
  id: string;
  especialidad: string;
  medico: string;
  fecha: string;
  hora: string;
  estado: AppointmentRow["estado"];
}

const rows = ref<CitaFila[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const pacienteLabel = props.patient.nombre?.trim() || props.patient.telefono;

onMounted(async () => {
  try {
    const clinicId = useClinicaStore().activeClinicId ?? undefined;

    const citas = await directus.request(
      readItems("appointments", {
        filter: {
          clinic: { _eq: clinicId },
          patient: { _eq: props.patient.id },
          estado: { _in: ["pendiente", "confirmada"] },
          inicio: dateCompareFilter("_gte", toIsoOrThrow(now())),
        },
        sort: ["inicio"],
        limit: -1,
      }),
    );

    if (citas.length === 0) return;

    // A propósito NO se usa el store `catalog`: cachea solo filas `activo: true`,
    // así que un médico o servicio dado de baja hoy con una cita confirmada
    // mañana saldría sin nombre — justo el caso que esta pantalla existe para
    // mostrar. Mismo criterio que lib/reports/context.ts.
    const doctorIds = [...new Set(citas.map((c) => c.doctor))];
    const serviceIds = [...new Set(citas.map((c) => c.service))];
    const [doctors, services, specialties] = await Promise.all([
      directus.request(readItems("doctors", { filter: { id: { _in: doctorIds } }, limit: -1 })),
      directus.request(readItems("services", { filter: { id: { _in: serviceIds } }, limit: -1 })),
      directus.request(readItems("specialties", { filter: { clinic: { _eq: clinicId } }, limit: -1 })),
    ]);

    const doctorName = new Map(doctors.map((d) => [d.id, d.nombre]));
    const specialtyOfService = new Map(services.map((s) => [s.id, s.specialty]));
    const specialtyName = new Map(specialties.map((s) => [s.id, s.nombre]));

    rows.value = citas.map((c) => {
      const inicio = new Date(c.inicio);
      // La especialidad de una cita es la de su SERVICIO, no la del médico (que
      // puede atender varias, y además la suya depende de la clínica).
      const specialtyId = specialtyOfService.get(c.service);
      return {
        id: c.id,
        especialidad: (specialtyId ? specialtyName.get(specialtyId) : undefined) ?? "—",
        medico: doctorName.get(c.doctor) ?? "—",
        fecha: formatDay(inicio),
        hora: formatTime(inicio),
        estado: c.estado,
      };
    });
  } catch (e) {
    error.value = friendlyErrorMessage(e, "No se pudieron cargar las citas del paciente.");
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-6">
    <div class="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <h2 class="font-display mb-1 text-lg font-bold text-brand-800">Próximas citas</h2>
      <p class="mb-4 text-xs text-slate-500">
        {{ pacienteLabel }} — citas pendientes y confirmadas de hoy en adelante.
      </p>

      <p v-if="loading" class="text-sm text-slate-500">Cargando…</p>
      <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>
      <EmptyState
        v-else-if="rows.length === 0"
        title="Sin citas próximas"
        description="Este paciente no tiene citas pendientes ni confirmadas a futuro."
      />
      <div v-else class="max-h-80 overflow-auto rounded-lg border border-slate-200">
        <table class="w-full min-w-[560px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50">
            <tr>
              <th class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Especialidad</th>
              <th class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Médico</th>
              <th class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Fecha</th>
              <th class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Hora</th>
              <th class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="c in rows" :key="c.id">
              <td class="px-3 py-2 text-slate-700">{{ c.especialidad }}</td>
              <td class="px-3 py-2 text-slate-600">{{ c.medico }}</td>
              <td class="px-3 py-2 capitalize text-slate-600">{{ c.fecha }}</td>
              <td class="px-3 py-2 text-slate-600">{{ c.hora }}</td>
              <td class="px-3 py-2">
                <Badge :tone="ESTADO_TONE[c.estado]">{{ ESTADO_LABELS[c.estado] }}</Badge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex justify-end gap-2 pt-4">
        <Button variant="secondary" @click="emit('close')">Cerrar</Button>
      </div>
    </div>
  </div>
</template>
