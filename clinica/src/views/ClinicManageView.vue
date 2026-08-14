<script setup lang="ts">
/**
 * Gestión de una clínica existente: datos propios + especialidades, médicos,
 * servicios y recepcionistas. Independiente de `useClinicaStore`/`useCatalogStore`
 * (esos scopean por la clínica ACTIVA de la sesión, que puede no ser esta) —
 * salvo al saltar a Horario, donde sí hace falta activarla temporalmente.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { readItem, readItems, readUsers, updateItem } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { ClinicDoctor, ClinicRow, ServiceRow, SpecialtyRow } from "@/lib/directus";
import { loadClinicDoctors } from "@/lib/clinicDoctors";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { useClinicaStore } from "@/stores/clinica";
import { useCatalogStore } from "@/stores/catalog";
import Button from "@/components/ui/Button.vue";
import Card from "@/components/ui/Card.vue";
import SpecialtiesTab from "@/components/clinics/SpecialtiesTab.vue";
import DoctorsTab from "@/components/clinics/DoctorsTab.vue";
import ServicesTab from "@/components/clinics/ServicesTab.vue";
import ReceptionTab from "@/components/clinics/ReceptionTab.vue";

const INPUT = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";
const LABEL = "mb-1 block text-sm font-medium text-slate-700";

const route = useRoute();
const router = useRouter();
const clinicId = computed(() => route.params.id as string);

const TABS = ["Datos", "Especialidades", "Médicos", "Servicios", "Recepción"] as const;
type Tab = (typeof TABS)[number];
const activeTab = ref<Tab>("Datos");

const clinic = ref<ClinicRow | null>(null);
const clinicError = ref<string | null>(null);
const loading = ref(true);

const specialties = ref<SpecialtyRow[]>([]);
const doctors = ref<ClinicDoctor[]>([]);
/** Datos de la cuenta Directus de cada médico con login, indexados por id de usuario. */
const doctorAccounts = ref<Record<string, { email: string; mustChangePassword: boolean }>>({});
const services = ref<ServiceRow[]>([]);

const datos = ref({
  nombre: "",
  zonaHoraria: "",
  whatsappNumero: "",
  ycloudApiKey: "",
  ycloudWebhookSecret: "",
  bookingPublicLinkToken: "",
  telefonoContacto: "",
  activo: true,
});
const savingDatos = ref(false);
const datosError = ref<string | null>(null);
const datosSaved = ref(false);

function fillDatos(row: ClinicRow): void {
  datos.value = {
    nombre: row.nombre,
    zonaHoraria: row.zona_horaria ?? "",
    whatsappNumero: row.whatsapp_numero ?? "",
    ycloudApiKey: row.ycloud_api_key ?? "",
    ycloudWebhookSecret: row.ycloud_webhook_secret ?? "",
    bookingPublicLinkToken: row.booking_public_link_token ?? "",
    telefonoContacto: row.telefono_contacto ?? "",
    activo: row.activo,
  };
}

async function loadClinic(): Promise<void> {
  clinic.value = await directus.request(readItem("clinics", clinicId.value));
  fillDatos(clinic.value);
}

async function loadSpecialties(): Promise<void> {
  specialties.value = await directus.request(
    readItems("specialties", { filter: { clinic: { _eq: clinicId.value } }, sort: ["nombre"], limit: -1 }),
  );
}

async function loadDoctors(): Promise<void> {
  // Incluye los desactivados en esta clínica (sin `soloActivos`): esta pantalla
  // es justamente donde se les da de baja y de alta.
  doctors.value = await loadClinicDoctors(clinicId.value);

  // `doctors` no trae nada de `directus_users`, así que el correo y la bandera
  // de "debe cambiar clave" van en una consulta aparte, solo para los médicos
  // que tienen cuenta.
  const userIds = doctors.value.map((d) => d.usuario).filter((id): id is string => Boolean(id));
  if (userIds.length === 0) {
    doctorAccounts.value = {};
    return;
  }
  try {
    const rows = (await directus.request(
      readUsers({
        filter: { id: { _in: userIds } },
        fields: ["id", "email", "must_change_password"],
        limit: -1,
      } as never),
    )) as { id: string; email: string | null; must_change_password: boolean | null }[];
    doctorAccounts.value = Object.fromEntries(
      rows.map((r) => [
        r.id,
        { email: r.email ?? "", mustChangePassword: r.must_change_password === true },
      ]),
    );
  } catch {
    // Sin esto solo se pierden el badge y el botón de restablecer; la lista de
    // médicos sigue siendo utilizable.
    doctorAccounts.value = {};
  }
}

async function loadServices(): Promise<void> {
  services.value = await directus.request(
    readItems("services", { filter: { clinic: { _eq: clinicId.value } }, sort: ["nombre"], limit: -1 }),
  );
}

onMounted(async () => {
  loading.value = true;
  clinicError.value = null;
  try {
    await Promise.all([loadClinic(), loadSpecialties(), loadDoctors(), loadServices()]);
  } catch (e) {
    clinicError.value = friendlyErrorMessage(e, "No se pudo cargar la clínica.");
  } finally {
    loading.value = false;
  }
});

async function saveDatos(): Promise<void> {
  datosError.value = null;
  datosSaved.value = false;
  if (!datos.value.nombre.trim()) {
    datosError.value = "El nombre es obligatorio.";
    return;
  }
  savingDatos.value = true;
  try {
    await directus.request(
      updateItem("clinics", clinicId.value, {
        nombre: datos.value.nombre.trim(),
        zona_horaria: datos.value.zonaHoraria.trim() || null,
        whatsapp_numero: datos.value.whatsappNumero.trim() || null,
        ycloud_api_key: datos.value.ycloudApiKey.trim() || null,
        ycloud_webhook_secret: datos.value.ycloudWebhookSecret.trim() || null,
        booking_public_link_token: datos.value.bookingPublicLinkToken.trim() || null,
        telefono_contacto: datos.value.telefonoContacto.trim() || null,
        activo: datos.value.activo,
      }),
    );
    datosSaved.value = true;
  } catch (e) {
    datosError.value = friendlyErrorMessage(e, "No se pudo guardar.");
  } finally {
    savingDatos.value = false;
  }
}

async function goToHorario(): Promise<void> {
  useClinicaStore().selectClinic(clinicId.value);
  useCatalogStore().reset();
  await router.push({ name: "horario" });
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <button type="button" class="mb-1 text-xs font-medium text-slate-400 hover:text-slate-600" @click="router.push({ name: 'admin-clinicas' })">
          ← Clínicas
        </button>
        <h1 class="font-display text-xl font-bold text-brand-900">{{ clinic?.nombre ?? "Gestionar clínica" }}</h1>
      </div>
      <Button v-if="clinic" variant="secondary" @click="goToHorario">Ir a Horario</Button>
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span class="h-4 w-4 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"></span>
      Cargando…
    </div>

    <div v-else-if="clinicError" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ clinicError }}
    </div>

    <template v-else>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="tab in TABS"
          :key="tab"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-medium transition"
          :class="tab === activeTab ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
          @click="activeTab = tab"
        >
          {{ tab }}
        </button>
      </div>

      <Card v-if="activeTab === 'Datos'" title="Datos de la clínica">
        <form class="space-y-4" @submit.prevent="saveDatos">
          <div>
            <label :class="LABEL">Nombre *</label>
            <input v-model="datos.nombre" :class="INPUT" />
          </div>
          <div>
            <label :class="LABEL">Zona horaria (IANA)</label>
            <input v-model="datos.zonaHoraria" :class="INPUT" placeholder="America/Costa_Rica (vacío = usa la global)" />
          </div>
          <div>
            <label :class="LABEL">Número de WhatsApp (E.164)</label>
            <input v-model="datos.whatsappNumero" :class="INPUT" placeholder="+50688887777" />
          </div>
          <div>
            <label :class="LABEL">YCloud API key</label>
            <input v-model="datos.ycloudApiKey" :class="INPUT" placeholder="Vacío = usa la global" />
          </div>
          <div>
            <label :class="LABEL">YCloud webhook secret</label>
            <input v-model="datos.ycloudWebhookSecret" :class="INPUT" placeholder="Vacío = usa la global" />
          </div>
          <div>
            <label :class="LABEL">Token del link público de agendar</label>
            <input v-model="datos.bookingPublicLinkToken" :class="INPUT" placeholder="Vacío = usa el global" />
          </div>
          <div>
            <label :class="LABEL">Teléfono de contacto (visible al paciente)</label>
            <input v-model="datos.telefonoContacto" :class="INPUT" placeholder="2222-3344" />
          </div>
          <div>
            <!--
              Solo lectura a propósito: el link vive en Short.io y editarlo acá no
              cambiaría el destino de la redirección, solo dejaría al panel
              enviando a los pacientes un link que no existe.
            -->
            <label :class="LABEL">Link corto de agendar</label>
            <input
              :value="clinic?.booking_short_url ?? ''"
              :class="[INPUT, 'bg-slate-50 text-slate-500']"
              readonly
              placeholder="Vacío = se usa el link largo con el id"
            />
            <p class="mt-1 text-xs text-slate-500">
              Lo genera <code>scripts/shorten-booking-links.ts</code> con Short.io. Es el enlace que la pantalla
              Mensajes pega en los avisos de cancelación.
            </p>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input v-model="datos.activo" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500/30" />
            Activa
          </label>

          <p v-if="datosError" class="text-sm text-red-600">{{ datosError }}</p>
          <p v-if="datosSaved" class="text-sm text-emerald-600">Guardado.</p>

          <Button type="submit" :loading="savingDatos">{{ savingDatos ? "Guardando…" : "Guardar" }}</Button>
        </form>
      </Card>

      <Card v-else-if="activeTab === 'Especialidades'" title="Especialidades">
        <SpecialtiesTab :clinic-id="clinicId" :specialties="specialties" @changed="loadSpecialties" />
      </Card>

      <Card v-else-if="activeTab === 'Médicos'" title="Médicos">
        <DoctorsTab
          :clinic-id="clinicId"
          :doctors="doctors"
          :specialties="specialties"
          :user-accounts="doctorAccounts"
          @changed="loadDoctors"
        />
      </Card>

      <Card v-else-if="activeTab === 'Servicios'" title="Servicios">
        <ServicesTab :clinic-id="clinicId" :services="services" :specialties="specialties" @changed="loadServices" />
      </Card>

      <Card v-else title="Recepción">
        <ReceptionTab :clinic-id="clinicId" />
      </Card>
    </template>
  </div>
</template>
