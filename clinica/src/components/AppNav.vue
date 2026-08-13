<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import NavIcon from "@/components/ui/NavIcon.vue";

/**
 * Navegación única del panel: la usan tanto el sidebar de escritorio como el
 * drawer móvil de `AppLayout.vue`, que antes repetían el mismo `v-for`.
 * `navigate` deja que el drawer se cierre al elegir una opción.
 */
const emit = defineEmits<{ navigate: [] }>();

type NavIconName = "dashboard" | "calendar" | "clock" | "flag" | "list" | "message" | "building" | "users" | "chart";

/** `exact`: solo se pinta activo en su propia URL. Puesto en `/citas`, que
 * comparte prefijo con `/citas/agendar`, para que estando en la segunda no se
 * pinten las dos. */
type NavLink = { to: string; label: string; icon: NavIconName; exact?: boolean };
/** Grupo siempre expandido: con dos hijos no vale la pena un estado de colapso. */
type NavGroup = { label: string; icon: NavIconName; children: Omit<NavLink, "icon">[] };
type NavItem = NavLink | NavGroup;

const auth = useAuthStore();

function isGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

const navItems = computed<NavItem[]>(() => {
  const items: NavItem[] = [
    { to: "/", label: "Dashboard", icon: "dashboard" },
    {
      // Consultar la agenda y agendar son dos pantallas distintas: comparten
      // el grupo, no los filtros.
      label: "Citas",
      icon: "calendar",
      children: [
        { to: "/citas", label: "Agendadas", exact: true },
        // Solo recepción/admin: la policy Doctor no tiene `appointments.create`.
        ...(auth.isReceptionist || auth.isAdmin ? [{ to: "/citas/agendar", label: "Agendar" }] : []),
      ],
    },
    { to: "/horario", label: "Horario", icon: "clock" },
    { to: "/suspensiones", label: "Suspensiones", icon: "flag" },
    // Para los tres roles: Directus recorta las filas, así que un médico ve los
    // mismos reportes calculados solo sobre sus citas.
    { to: "/reportes", label: "Reportes", icon: "chart" },
  ];
  // Solo recepción/admin: el mantenimiento de la ficha del paciente (y su baja)
  // no es parte del flujo de un médico, que además solo puede leer los pacientes
  // con los que tiene cita.
  if (auth.isReceptionist || auth.isAdmin) items.push({ to: "/pacientes", label: "Pacientes", icon: "users" });
  // Solo recepción/admin: la gestión de lista de espera no es parte del flujo de un médico.
  if (auth.isReceptionist || auth.isAdmin) items.push({ to: "/lista-espera", label: "Lista de espera", icon: "list" });
  // Solo recepción: es su flujo de trabajo, y la policy Doctor ni siquiera tiene
  // permisos sobre `messages`, así que a un médico le saldrían puros 403.
  if (auth.isReceptionist) items.push({ to: "/mensajes", label: "Mensajes", icon: "message" });
  // Solo Administrator: da de alta clínicas nuevas, no es parte del trabajo diario de médicos/recepción.
  if (auth.isAdmin) items.push({ to: "/admin/clinicas", label: "Clínicas", icon: "building" });
  return items;
});

const linkClasses =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900";
const childLinkClasses =
  "flex items-center rounded-lg py-1.5 pl-11 pr-3 text-[13px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900";
const activeLinkClasses = "!bg-brand-50 !text-brand-800";
</script>

<template>
  <nav class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
    <template v-for="item in navItems" :key="isGroup(item) ? item.label : item.to">
      <div v-if="isGroup(item)">
        <!-- Encabezado no clicable: el grupo no tiene pantalla propia, sus hijos sí. -->
        <div class="flex items-center gap-3 px-3 py-2 text-sm font-medium text-slate-500">
          <span class="h-4.5 w-4.5 flex-none"><NavIcon :name="item.icon" /></span>
          {{ item.label }}
        </div>
        <RouterLink
          v-for="child in item.children"
          :key="child.to"
          :to="child.to"
          :class="childLinkClasses"
          :active-class="child.exact ? '' : activeLinkClasses"
          :exact-active-class="activeLinkClasses"
          @click="emit('navigate')"
        >
          {{ child.label }}
        </RouterLink>
      </div>
      <RouterLink
        v-else
        :to="item.to"
        :class="linkClasses"
        :active-class="item.exact ? '' : activeLinkClasses"
        :exact-active-class="activeLinkClasses"
        @click="emit('navigate')"
      >
        <span class="h-4.5 w-4.5 flex-none"><NavIcon :name="item.icon" /></span>
        {{ item.label }}
      </RouterLink>
    </template>
  </nav>
</template>
