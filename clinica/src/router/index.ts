import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useClinicaStore } from "@/stores/clinica";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
      meta: { public: true },
    },
    {
      path: "/",
      name: "dashboard",
      component: () => import("@/views/DashboardView.vue"),
    },
    {
      path: "/citas",
      name: "citas",
      component: () => import("@/views/AppointmentsView.vue"),
    },
    {
      path: "/horario",
      name: "horario",
      component: () => import("@/views/WorkingHoursView.vue"),
    },
    {
      path: "/suspensiones",
      name: "suspensiones",
      component: () => import("@/views/TimeOffView.vue"),
    },
    {
      // Mantenimiento de la ficha del paciente. Recepción y administrador: la
      // policy Doctor solo lee los pacientes con los que tiene cita y no puede
      // crearlos ni editarlos, así que a un médico le saldrían puros 403.
      path: "/pacientes",
      name: "pacientes",
      component: () => import("@/views/PatientsView.vue"),
      meta: { blockDoctor: true },
    },
    {
      path: "/lista-espera",
      name: "lista-espera",
      component: () => import("@/views/WaitlistView.vue"),
      meta: { blockDoctor: true },
    },
    {
      // Catálogo de reportes. Sin meta de bloqueo: entran los tres roles y es
      // Directus quien recorta las FILAS (la policy Doctor solo deja leer las
      // citas propias), así que un médico ve los mismos reportes con sus datos.
      path: "/reportes",
      name: "reportes",
      component: () => import("@/views/ReportsIndexView.vue"),
    },
    {
      // Renderizador genérico: la definición sale del registro
      // (src/lib/reports/registry.ts) según :reportId, así que un reporte nuevo
      // NO necesita una ruta nueva.
      path: "/reportes/:reportId",
      name: "reporte",
      component: () => import("@/views/ReportView.vue"),
    },
    {
      // Confirmaciones y recordatorios de seguimiento que la recepción envía a
      // mano mientras la cuenta de WhatsApp Business está bloqueada.
      path: "/mensajes",
      name: "mensajes",
      component: () => import("@/views/MessagesView.vue"),
      meta: { receptionistOnly: true },
    },
    {
      // Enlace enviado por WhatsApp: agendar sin login. No usa AppLayout ni
      // requiere sesión de Directus — habla con la API pública del bot
      // (VITE_BOOKING_API_URL), no con Directus directamente.
      path: "/agendar",
      name: "agendar",
      component: () => import("@/views/PublicBookingView.vue"),
      meta: { public: true },
    },
    {
      // Se muestra tras el login cuando el usuario está vinculado a más de
      // una clínica (típicamente una recepcionista) y aún no eligió con
      // cuál trabajar en esta pestaña.
      path: "/seleccionar-clinica",
      name: "seleccionar-clinica",
      component: () => import("@/views/SelectClinicView.vue"),
      // No es pública (exige sesión), pero tampoco lleva el layout con
      // sidebar/nav — es una pantalla intermedia como el login.
      meta: { bare: true },
    },
    {
      // Pide el correo con el enlace de restablecimiento (flujo nativo de
      // Directus, /auth/password/request). Pública: quien la usa no puede entrar.
      path: "/recuperar-clave",
      name: "recuperar-clave",
      component: () => import("@/views/ForgotPasswordView.vue"),
      meta: { public: true },
    },
    {
      // Destino del enlace del correo (?token=...). La URL debe coincidir
      // EXACTAMENTE con PASSWORD_RESET_URL_ALLOW_LIST en el docker-compose de
      // Directus y con VITE_PASSWORD_RESET_URL del panel.
      path: "/restablecer",
      name: "restablecer",
      component: () => import("@/views/ResetPasswordView.vue"),
      meta: { public: true },
    },
    {
      // Pantalla trampa del primer ingreso: exige sesión pero no lleva sidebar,
      // igual que seleccionar-clinica. El guard de abajo manda acá a todo
      // usuario con `must_change_password` y no lo deja ir a otro lado.
      path: "/cambiar-clave",
      name: "cambiar-clave",
      component: () => import("@/views/ForcePasswordChangeView.vue"),
      meta: { bare: true },
    },
    {
      // Cambio voluntario de contraseña y datos propios. Sí va dentro del layout.
      path: "/perfil",
      name: "perfil",
      component: () => import("@/views/ProfileView.vue"),
    },
    {
      // Lista de todas las clínicas (activas e inactivas). Solo Administrator.
      path: "/admin/clinicas",
      name: "admin-clinicas",
      component: () => import("@/views/ClinicsListView.vue"),
      meta: { adminOnly: true },
    },
    {
      // Wizard de alta de clínica completa (datos, especialidades, médicos,
      // servicios, recepcionistas). Solo para la cuenta Administrator: crea
      // una clínica NUEVA, así que no depende de (ni debe forzar) elegir una
      // clínica activa entre las existentes.
      path: "/admin/clinicas/nuevo",
      name: "admin-clinicas-nuevo",
      component: () => import("@/views/ClinicOnboardingView.vue"),
      meta: { adminOnly: true },
    },
    {
      // Gestión de una clínica existente: datos propios + especialidades,
      // médicos, servicios y recepcionistas. Misma razón que arriba para no
      // depender de la clínica activa de la sesión.
      path: "/admin/clinicas/:id",
      name: "admin-clinicas-detalle",
      component: () => import("@/views/ClinicManageView.vue"),
      meta: { adminOnly: true },
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (to.name === "login" && auth.isAuthenticated) {
    return { name: "dashboard" };
  }
  // Cambio obligatorio en el primer ingreso. Va acá y no más abajo a propósito:
  // antes de `needsSelection`, porque una recepcionista con dos clínicas debe
  // arreglar su contraseña PRIMERO (el selector de clínica no es una pantalla de
  // bloqueo y el rebote confundiría), y antes de los checks de rol, porque el
  // forzado aplica a todos, admin incluido. Después del check de `login` para
  // que un usuario ya logueado que escribe /login rebote a dashboard y caiga acá
  // en la re-evaluación. `!to.meta.public` deja pasar /agendar y /restablecer.
  if (!to.meta.public && auth.isAuthenticated && auth.mustChangePassword && to.name !== "cambiar-clave") {
    return { name: "cambiar-clave" };
  }
  // Y al revés: sin la bandera, esa pantalla es un callejón sin salida si se
  // llega escribiendo la URL.
  if (to.name === "cambiar-clave" && !auth.mustChangePassword) {
    return { name: "dashboard" };
  }
  if (!to.meta.public && auth.isAuthenticated && to.name !== "seleccionar-clinica" && !to.meta.adminOnly) {
    const clinica = useClinicaStore();
    // El caso 0 clínicas es un usuario (típicamente recepción) desactivado en
    // todas las que tenía vinculadas — sin esto, cae en un dashboard vacío sin
    // explicación. Admin no depende de `clinics_directus_users`, no aplica.
    if (clinica.needsSelection || (clinica.loaded && clinica.clinics.length === 0 && !auth.isAdmin)) {
      return { name: "seleccionar-clinica" };
    }
  }
  // Es UX, no seguridad: el control real lo hace Directus (la policy Doctor no
  // tiene permisos sobre `messages`). Esto solo evita que un médico que escriba
  // la URL a mano caiga en una pantalla que le mostraría puros 403. Es seguro
  // leer el rol aquí porque main.ts resuelve la sesión antes de montar el router.
  if (to.meta.receptionistOnly && !auth.isReceptionist) {
    return { name: "dashboard" };
  }
  // Igual que receptionistOnly: es UX, evita que un médico que escriba la URL a
  // mano caiga en la pantalla de lista de espera (fuera de su flujo de trabajo).
  if (to.meta.blockDoctor && !auth.isReceptionist && !auth.isAdmin) {
    return { name: "dashboard" };
  }
  // Misma lógica: el control real es que Administrator es el único rol con
  // admin_access, así que cualquier otro usuario que escriba la URL a mano
  // solo vería 403 de Directus al intentar crear la clínica.
  if (to.meta.adminOnly && !auth.isAdmin) {
    return { name: "dashboard" };
  }
  return true;
});

export default router;
