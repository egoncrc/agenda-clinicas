<script setup lang="ts">
/**
 * Wizard de alta de clínica completa: crea en un solo flujo la clínica, sus
 * especialidades, médicos (+ login + horario), servicios y recepcionistas
 * (+ login). Solo accesible a la cuenta Administrator (ver router meta
 * `adminOnly` y `auth.isAdmin`) — no hay otro rol pensado para dar de alta
 * clínicas nuevas.
 *
 * Cada fila se crea con su propio try/catch: si un médico falla, no aborta a
 * los demás ni a los servicios/recepcionistas. El resultado se muestra en un
 * log secuencial. No hay reintento automático: una vez creada la clínica, se
 * bloquea el botón para no duplicarla; lo que haya fallado se corrige a mano
 * desde el panel admin de Directus (ya queda el id de la clínica en pantalla).
 */
import { computed, reactive, ref } from "vue";
import { createItem, createUser, readRoles } from "@directus/sdk";
import { directus } from "@/lib/directus";
import type { ClinicRow, SpecialtyRow, DoctorRow, IsoWeekday } from "@/lib/directus";
import { friendlyErrorMessage } from "@/lib/directusErrors";
import { randomPassword } from "@/lib/passwords";
import { useConfirm } from "@/composables/useConfirm";
import { useCopyToClipboard } from "@/composables/useCopyToClipboard";
import Button from "@/components/ui/Button.vue";
import Card from "@/components/ui/Card.vue";
import TimeSelect from "@/components/ui/TimeSelect.vue";

const confirm = useConfirm();
const { copiedKey, copyError, copy } = useCopyToClipboard();

const INPUT = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";
const LABEL = "mb-1 block text-sm font-medium text-slate-700";

const DIAS: { value: IsoWeekday; label: string }[] = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 7, label: "Dom" },
];

const STEPS = ["Clínica", "Especialidades", "Médicos", "Servicios", "Recepción", "Revisar y crear"];
const step = ref(0);

const clinic = reactive({ nombre: "", zonaHoraria: "", whatsappNumero: "" });

const specialties = ref<string[]>(["Odontología"]);
function addSpecialty(): void {
  specialties.value.push("");
}
function removeSpecialty(i: number): void {
  specialties.value.splice(i, 1);
}

interface DoctorDraft {
  nombre: string;
  specialty: string;
  email: string;
  password: string;
  dias: IsoWeekday[];
  horaInicio: string;
  horaFin: string;
}
function newDoctor(): DoctorDraft {
  return { nombre: "", specialty: specialties.value[0] ?? "", email: "", password: randomPassword(), dias: [], horaInicio: "", horaFin: "" };
}
const doctors = ref<DoctorDraft[]>([newDoctor()]);
function addDoctor(): void {
  doctors.value.push(newDoctor());
}
function removeDoctor(i: number): void {
  doctors.value.splice(i, 1);
}
function toggleDia(doc: DoctorDraft, dia: IsoWeekday): void {
  const idx = doc.dias.indexOf(dia);
  if (idx === -1) doc.dias.push(dia);
  else doc.dias.splice(idx, 1);
}

interface ServiceDraft {
  nombre: string;
  specialty: string;
  duracionMin: number;
  bufferMin: number;
  recallMeses: number | null;
}
function newService(): ServiceDraft {
  return { nombre: "", specialty: specialties.value[0] ?? "", duracionMin: 30, bufferMin: 0, recallMeses: null };
}
const services = ref<ServiceDraft[]>([newService()]);
function addService(): void {
  services.value.push(newService());
}
function removeService(i: number): void {
  services.value.splice(i, 1);
}

interface ReceptionistDraft {
  nombre: string;
  email: string;
  password: string;
}
function newReceptionist(): ReceptionistDraft {
  return { nombre: "", email: "", password: randomPassword() };
}
const receptionists = ref<ReceptionistDraft[]>([]);
function addReceptionist(): void {
  receptionists.value.push(newReceptionist());
}
function removeReceptionist(i: number): void {
  receptionists.value.splice(i, 1);
}

const validSpecialties = computed(() => specialties.value.map((s) => s.trim()).filter(Boolean));
const canCreate = computed(() => clinic.nombre.trim().length > 0 && validSpecialties.value.length > 0);

type LogStatus = "ok" | "error";
const log = ref<{ label: string; status: LogStatus; message?: string }[]>([]);
function pushLog(label: string, status: LogStatus, message?: string): void {
  log.value.push({ label, status, message });
}

const creating = ref(false);
const done = ref(false);
const createdClinic = ref<ClinicRow | null>(null);

/**
 * Credenciales de las cuentas efectivamente creadas, para mostrarlas al final.
 * Antes se perdían: el log no repite la contraseña y `startOver()` regenera los
 * borradores, así que si el admin no las copiaba de la pantalla intermedia la
 * única salida era restablecerlas una por una.
 */
interface CreatedCredential {
  rol: "Médico" | "Recepcionista";
  nombre: string;
  email: string;
  password: string;
}
const credentials = ref<CreatedCredential[]>([]);

async function runCreation(): Promise<void> {
  if (creating.value || createdClinic.value) return;
  creating.value = true;
  log.value = [];

  const clinicPayload: Record<string, unknown> = { nombre: clinic.nombre.trim(), activo: true };
  if (clinic.zonaHoraria.trim()) clinicPayload.zona_horaria = clinic.zonaHoraria.trim();
  if (clinic.whatsappNumero.trim()) clinicPayload.whatsapp_numero = clinic.whatsappNumero.trim();

  try {
    const row = await directus.request(createItem("clinics", clinicPayload as never));
    createdClinic.value = row as ClinicRow;
    pushLog(`Clínica "${row.nombre}" creada`, "ok");
  } catch (e) {
    pushLog("Clínica", "error", friendlyErrorMessage(e, "No se pudo crear la clínica."));
    creating.value = false;
    return;
  }
  const clinicId = createdClinic.value.id;

  const specialtyIds = new Map<string, string>();
  for (const nombre of validSpecialties.value) {
    try {
      const row = await directus.request(
        createItem("specialties", { nombre, activo: true, clinic: clinicId }),
      );
      specialtyIds.set(nombre, (row as SpecialtyRow).id);
      pushLog(`Especialidad "${nombre}"`, "ok");
    } catch (e) {
      pushLog(`Especialidad "${nombre}"`, "error", friendlyErrorMessage(e, "No se pudo crear."));
    }
  }

  const activeDoctors = doctors.value.filter((d) => d.nombre.trim());
  const activeReceptionists = receptionists.value.filter((r) => r.nombre.trim() && r.email.trim());

  let doctorRoleId: string | undefined;
  let receptionistRoleId: string | undefined;
  if (activeDoctors.length > 0 || activeReceptionists.length > 0) {
    try {
      const roles = (await directus.request(
        readRoles({ filter: { name: { _in: ["Doctor", "Receptionist"] } }, fields: ["id", "name"] } as never),
      )) as { id: string; name: string }[];
      doctorRoleId = roles.find((r) => r.name === "Doctor")?.id;
      receptionistRoleId = roles.find((r) => r.name === "Receptionist")?.id;
      if (activeDoctors.some((d) => d.email.trim()) && !doctorRoleId) {
        pushLog("Rol Doctor", "error", "No se encontró el rol 'Doctor' en Directus — los médicos se crean sin login.");
      }
      if (activeReceptionists.length > 0 && !receptionistRoleId) {
        pushLog("Rol Receptionist", "error", "No se encontró el rol 'Receptionist' en Directus.");
      }
    } catch (e) {
      pushLog("Roles", "error", friendlyErrorMessage(e, "No se pudieron leer los roles."));
    }
  }

  for (const doc of activeDoctors) {
    const specialtyId = specialtyIds.get(doc.specialty.trim());
    if (!specialtyId) {
      pushLog(`Médico "${doc.nombre}"`, "error", "Su especialidad no se creó correctamente, se omite.");
      continue;
    }
    try {
      let usuarioId: string | undefined;
      if (doc.email.trim() && doctorRoleId) {
        const userRow = (await directus.request(
          createUser({
            email: doc.email.trim(),
            password: doc.password,
            first_name: doc.nombre.trim(),
            role: doctorRoleId,
            status: "active",
            // Contraseña temporal: el titular define la suya al ingresar.
            must_change_password: true,
          } as never),
        )) as { id: string };
        usuarioId = userRow.id;
        // Se apunta apenas la cuenta existe, no al final: si algo falla después,
        // esa credencial ya es real y perderla sería peor.
        credentials.value.push({
          rol: "Médico",
          nombre: doc.nombre.trim(),
          email: doc.email.trim(),
          password: doc.password,
        });
      }
      const doctorRow = (await directus.request(
        createItem("doctors", {
          nombre: doc.nombre.trim(),
          activo: true,
          ...(usuarioId ? { usuario: usuarioId } : {}),
        }),
      )) as DoctorRow;
      // La especialidad y el alta van en la fila puente, no en `doctors`: el
      // médico podría vincularse después a otra clínica con otra especialidad.
      await directus.request(
        createItem("clinics_doctors", {
          clinics_id: clinicId,
          doctors_id: doctorRow.id,
          specialty: specialtyId,
          activo: true,
        }),
      );
      pushLog(`Médico "${doc.nombre}"${usuarioId ? " (con acceso al panel)" : ""}`, "ok");

      if (doc.horaInicio && doc.horaFin) {
        for (const dia of doc.dias) {
          try {
            await directus.request(
              createItem("working_hours", {
                doctor: doctorRow.id,
                clinic: clinicId,
                dia_semana: dia,
                hora_inicio: `${doc.horaInicio}:00`,
                hora_fin: `${doc.horaFin}:00`,
              }),
            );
          } catch (e) {
            pushLog(`Horario de "${doc.nombre}"`, "error", friendlyErrorMessage(e, "No se pudo guardar un día."));
          }
        }
      }
    } catch (e) {
      pushLog(`Médico "${doc.nombre}"`, "error", friendlyErrorMessage(e, "No se pudo crear."));
    }
  }

  for (const svc of services.value.filter((s) => s.nombre.trim())) {
    const specialtyId = specialtyIds.get(svc.specialty.trim());
    if (!specialtyId) {
      pushLog(`Servicio "${svc.nombre}"`, "error", "Su especialidad no se creó correctamente, se omite.");
      continue;
    }
    try {
      await directus.request(
        createItem("services", {
          nombre: svc.nombre.trim(),
          duracion_min: svc.duracionMin,
          buffer_min: svc.bufferMin,
          activo: true,
          clinic: clinicId,
          specialty: specialtyId,
          ...(svc.recallMeses ? { recall_meses: svc.recallMeses } : {}),
        }),
      );
      pushLog(`Servicio "${svc.nombre}"`, "ok");
    } catch (e) {
      pushLog(`Servicio "${svc.nombre}"`, "error", friendlyErrorMessage(e, "No se pudo crear."));
    }
  }

  for (const rec of activeReceptionists) {
    if (!receptionistRoleId) {
      pushLog(`Recepcionista "${rec.nombre}"`, "error", "Rol Receptionist no disponible, se omite.");
      continue;
    }
    try {
      const userRow = (await directus.request(
        createUser({
          email: rec.email.trim(),
          password: rec.password,
          first_name: rec.nombre.trim(),
          role: receptionistRoleId,
          status: "active",
          // Contraseña temporal: la titular define la suya al ingresar.
          must_change_password: true,
        } as never),
      )) as { id: string };
      credentials.value.push({
        rol: "Recepcionista",
        nombre: rec.nombre.trim(),
        email: rec.email.trim(),
        password: rec.password,
      });
      await directus.request(
        createItem("clinics_directus_users" as never, {
          clinics_id: clinicId,
          directus_users_id: userRow.id,
        } as never),
      );
      pushLog(`Recepcionista "${rec.nombre}"`, "ok");
    } catch (e) {
      pushLog(`Recepcionista "${rec.nombre}"`, "error", friendlyErrorMessage(e, "No se pudo crear."));
    }
  }

  creating.value = false;
  done.value = true;
}

/** Texto plano con todas las credenciales, una por línea, para pegarlo donde haga falta. */
const allCredentialsText = computed(() =>
  credentials.value.map((c) => `${c.rol}: ${c.nombre} — ${c.email} — ${c.password}`).join("\n"),
);

function copyOne(c: CreatedCredential): void {
  void copy(`${c.email}\n${c.password}`, c.email);
}

function copyAll(): void {
  void copy(allCredentialsText.value, "__todas__");
}

async function startOver(): Promise<void> {
  // Las contraseñas no se guardan en claro en ningún lado: si se limpian sin
  // haberlas copiado, la única salida es restablecerlas una por una.
  if (credentials.value.length > 0) {
    const ok = await confirm({
      title: "Crear otra clínica",
      message: "¿Ya copiaste las credenciales? No se vuelven a mostrar.",
      confirmLabel: "Sí, ya las copié",
      tone: "warn",
    });
    if (!ok) return;
  }
  credentials.value = [];
  clinic.nombre = "";
  clinic.zonaHoraria = "";
  clinic.whatsappNumero = "";
  specialties.value = ["Odontología"];
  doctors.value = [newDoctor()];
  services.value = [newService()];
  receptionists.value = [];
  log.value = [];
  createdClinic.value = null;
  done.value = false;
  step.value = 0;
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <div>
      <h1 class="font-display text-xl font-bold text-brand-900">Alta de clínica</h1>
      <p class="text-sm text-slate-500">Crea una clínica nueva con sus especialidades, médicos, servicios y recepcionistas.</p>
    </div>

    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="(label, i) in STEPS"
        :key="label"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-medium transition"
        :class="i === step ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
        :disabled="creating || done"
        @click="step = i"
      >
        {{ i + 1 }}. {{ label }}
      </button>
    </div>

    <!-- Paso 1: Clínica -->
    <Card v-if="step === 0" title="Datos de la clínica">
      <div class="space-y-4">
        <div>
          <label :class="LABEL">Nombre *</label>
          <input v-model="clinic.nombre" :class="INPUT" placeholder="Clínica Norte" />
        </div>
        <div>
          <label :class="LABEL">Zona horaria (IANA)</label>
          <input v-model="clinic.zonaHoraria" :class="INPUT" placeholder="America/Costa_Rica (vacío = usa la global)" />
        </div>
        <div>
          <label :class="LABEL">Número de WhatsApp (E.164)</label>
          <input v-model="clinic.whatsappNumero" :class="INPUT" placeholder="+50688887777 (vacío = clínica por defecto)" />
        </div>
      </div>
    </Card>

    <!-- Paso 2: Especialidades -->
    <Card v-else-if="step === 1" title="Especialidades">
      <div class="space-y-2">
        <div v-for="(_, i) in specialties" :key="i" class="flex gap-2">
          <input v-model="specialties[i]" :class="INPUT" placeholder="Odontología" />
          <Button variant="secondary" size="sm" @click="removeSpecialty(i)">Quitar</Button>
        </div>
        <Button variant="ghost" size="sm" @click="addSpecialty">+ Agregar especialidad</Button>
      </div>
    </Card>

    <!-- Paso 3: Médicos -->
    <Card v-else-if="step === 2" title="Médicos">
      <div class="space-y-5">
        <div v-for="(doc, i) in doctors" :key="i" class="space-y-3 rounded-lg border border-slate-200 p-3">
          <div class="flex items-start justify-between gap-2">
            <div class="grid flex-1 gap-3 sm:grid-cols-2">
              <div>
                <label :class="LABEL">Nombre</label>
                <input v-model="doc.nombre" :class="INPUT" placeholder="Dr. Juan Pérez" />
              </div>
              <div>
                <label :class="LABEL">Especialidad</label>
                <select v-model="doc.specialty" :class="INPUT">
                  <option v-for="s in validSpecialties" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
              <div>
                <label :class="LABEL">Correo (login al panel, opcional)</label>
                <input v-model="doc.email" type="email" :class="INPUT" placeholder="doctor@ejemplo.com" />
              </div>
              <div>
                <label :class="LABEL">Contraseña</label>
                <input v-model="doc.password" :class="INPUT" />
              </div>
            </div>
            <Button variant="secondary" size="sm" @click="removeDoctor(i)">Quitar</Button>
          </div>

          <div>
            <label :class="LABEL">Días que atiende</label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="d in DIAS"
                :key="d.value"
                type="button"
                class="rounded-md px-2.5 py-1 text-xs font-medium transition"
                :class="doc.dias.includes(d.value) ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                @click="toggleDia(doc, d.value)"
              >
                {{ d.label }}
              </button>
            </div>
          </div>
          <div class="flex gap-3">
            <div class="flex-1">
              <label :class="LABEL">Hora inicio</label>
              <TimeSelect v-model="doc.horaInicio" />
            </div>
            <div class="flex-1">
              <label :class="LABEL">Hora fin</label>
              <TimeSelect v-model="doc.horaFin" />
            </div>
          </div>
          <p class="text-xs text-slate-400">Mismo horario para todos los días marcados. Se puede afinar después desde "Horario".</p>
        </div>
        <Button variant="ghost" size="sm" @click="addDoctor">+ Agregar médico</Button>
      </div>
    </Card>

    <!-- Paso 4: Servicios -->
    <Card v-else-if="step === 3" title="Servicios">
      <div class="space-y-3">
        <div v-for="(svc, i) in services" :key="i" class="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
          <div class="grid flex-1 gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label :class="LABEL">Nombre</label>
              <input v-model="svc.nombre" :class="INPUT" placeholder="Limpieza dental" />
            </div>
            <div>
              <label :class="LABEL">Especialidad</label>
              <select v-model="svc.specialty" :class="INPUT">
                <option v-for="s in validSpecialties" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <div>
              <label :class="LABEL">Recordatorio de seguimiento (meses)</label>
              <input v-model.number="svc.recallMeses" type="number" min="0" :class="INPUT" placeholder="Vacío = ninguno" />
            </div>
            <div>
              <label :class="LABEL">Duración (min)</label>
              <input v-model.number="svc.duracionMin" type="number" min="1" :class="INPUT" />
            </div>
            <div>
              <label :class="LABEL">Buffer entre citas (min)</label>
              <input v-model.number="svc.bufferMin" type="number" min="0" :class="INPUT" />
            </div>
          </div>
          <Button variant="secondary" size="sm" @click="removeService(i)">Quitar</Button>
        </div>
        <Button variant="ghost" size="sm" @click="addService">+ Agregar servicio</Button>
      </div>
    </Card>

    <!-- Paso 5: Recepcionistas -->
    <Card v-else-if="step === 4" title="Recepcionistas">
      <div class="space-y-3">
        <p v-if="receptionists.length === 0" class="text-sm text-slate-400">Opcional — se puede agregar después.</p>
        <div v-for="(rec, i) in receptionists" :key="i" class="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
          <div class="grid flex-1 gap-3 sm:grid-cols-2">
            <div>
              <label :class="LABEL">Nombre</label>
              <input v-model="rec.nombre" :class="INPUT" placeholder="María López" />
            </div>
            <div>
              <label :class="LABEL">Correo</label>
              <input v-model="rec.email" type="email" :class="INPUT" placeholder="recepcion@ejemplo.com" />
            </div>
            <div>
              <label :class="LABEL">Contraseña</label>
              <input v-model="rec.password" :class="INPUT" />
            </div>
          </div>
          <Button variant="secondary" size="sm" @click="removeReceptionist(i)">Quitar</Button>
        </div>
        <Button variant="ghost" size="sm" @click="addReceptionist">+ Agregar recepcionista</Button>
      </div>
    </Card>

    <!-- Paso 6: Revisar y crear -->
    <Card v-else title="Revisar y crear">
      <div v-if="!done" class="space-y-4">
        <ul class="space-y-1 text-sm text-slate-600">
          <li><strong>Clínica:</strong> {{ clinic.nombre || "(sin nombre)" }}</li>
          <li><strong>Especialidades:</strong> {{ validSpecialties.join(", ") || "—" }}</li>
          <li><strong>Médicos:</strong> {{ doctors.filter((d) => d.nombre.trim()).length }}</li>
          <li><strong>Servicios:</strong> {{ services.filter((s) => s.nombre.trim()).length }}</li>
          <li><strong>Recepcionistas:</strong> {{ receptionists.filter((r) => r.nombre.trim()).length }}</li>
        </ul>
        <p v-if="!canCreate" class="text-sm text-amber-600">Falta el nombre de la clínica o al menos una especialidad.</p>
        <Button :disabled="!canCreate" :loading="creating" @click="runCreation">
          {{ creating ? "Creando…" : "Crear clínica" }}
        </Button>
      </div>

      <div v-if="log.length > 0" class="mt-4 space-y-1 border-t border-slate-200 pt-4">
        <p v-for="(entry, i) in log" :key="i" class="text-sm" :class="entry.status === 'ok' ? 'text-slate-600' : 'text-red-600'">
          {{ entry.status === "ok" ? "✓" : "✗" }} {{ entry.label }}<span v-if="entry.message"> — {{ entry.message }}</span>
        </p>
      </div>

      <!-- Credenciales de las cuentas creadas. No se guardan en claro en ningún
           lado: si esta pantalla se cierra sin copiarlas, hay que restablecerlas. -->
      <div v-if="credentials.length > 0" class="mt-4 border-t border-slate-200 pt-4">
        <div class="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs font-semibold text-amber-900">
              Credenciales de acceso — esta es la única vez que se muestran.
            </p>
            <button
              type="button"
              class="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
              @click="copyAll"
            >
              {{ copiedKey === "__todas__" ? "¡Copiado!" : "Copiar todas" }}
            </button>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead>
                <tr class="text-amber-900/70">
                  <th class="py-1 pr-3 font-medium">Quién</th>
                  <th class="py-1 pr-3 font-medium">Correo</th>
                  <th class="py-1 pr-3 font-medium">Contraseña</th>
                  <th class="py-1"></th>
                </tr>
              </thead>
              <tbody class="font-mono text-slate-800">
                <tr v-for="c in credentials" :key="c.email" class="border-t border-amber-200/60">
                  <td class="py-1.5 pr-3 whitespace-nowrap">{{ c.rol }}: {{ c.nombre }}</td>
                  <td class="py-1.5 pr-3 break-all">{{ c.email }}</td>
                  <td class="py-1.5 pr-3 font-semibold break-all">{{ c.password }}</td>
                  <td class="py-1.5">
                    <button
                      type="button"
                      class="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-sans text-xs font-medium text-amber-900 transition hover:bg-amber-100"
                      @click="copyOne(c)"
                    >
                      {{ copiedKey === c.email ? "¡Copiado!" : "Copiar" }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p v-if="copyError" class="mt-2 text-xs text-red-700">{{ copyError }}</p>
          <p class="mt-3 text-xs text-amber-800">
            Cada persona tendrá que definir su propia contraseña la primera vez que ingrese.
          </p>
        </div>
      </div>

      <div v-if="done" class="mt-4 flex gap-2 border-t border-slate-200 pt-4">
        <Button variant="secondary" @click="startOver">Crear otra clínica</Button>
      </div>
    </Card>

    <div v-if="!done" class="flex justify-between">
      <Button variant="secondary" :disabled="step === 0 || creating" @click="step--">Anterior</Button>
      <Button v-if="step < STEPS.length - 1" :disabled="creating" @click="step++">Siguiente</Button>
    </div>
  </div>
</template>
