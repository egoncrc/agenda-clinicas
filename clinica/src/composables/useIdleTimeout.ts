import { onUnmounted, reactive, readonly, watch } from "vue";
import { readMe } from "@directus/sdk";
import { directus, handleExpiredSession } from "@/lib/directus";
import { useAuthStore } from "@/stores/auth";
import router from "@/router";
import {
  ACTIVITY_WRITE_THROTTLE_MS,
  IDLE_LOGOUT_CLAIM_KEY,
  LAST_ACTIVITY_KEY,
  TICK_INTERVAL_MS,
  getIdlePhase,
  isClaimFresh,
  resolveSeedActivity,
  secondsUntilLogout,
} from "@/lib/idleTimeout";

const state = reactive({ showWarning: false, secondsRemaining: 0 });

let lastActivityLocal = Date.now();
let lastWriteAt = 0;
let tickTimer: ReturnType<typeof setInterval> | undefined;
let listenersAttached = false;
let idleLogoutInProgress = false;
let started = false;

const ACTIVITY_EVENTS = ["mousemove", "click", "keydown", "touchstart"] as const;

function recordActivity(): void {
  lastActivityLocal = Date.now();
  state.showWarning = false;
  if (lastActivityLocal - lastWriteAt > ACTIVITY_WRITE_THROTTLE_MS) {
    lastWriteAt = lastActivityLocal;
    localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityLocal));
  }
}

/** Sin throttle: usado por `stayConnected()`, una acción deliberada que las otras pestañas deben ver ya. */
function broadcastActivityNow(): void {
  lastActivityLocal = Date.now();
  lastWriteAt = lastActivityLocal;
  state.showWarning = false;
  localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityLocal));
}

async function runFollowerCleanup(): Promise<void> {
  if (idleLogoutInProgress) return;
  idleLogoutInProgress = true;
  stop();
  await handleExpiredSession("inactividad");
}

async function triggerIdleLogout(): Promise<void> {
  if (idleLogoutInProgress) return;
  const now = Date.now();
  const claim = Number(localStorage.getItem(IDLE_LOGOUT_CLAIM_KEY)) || null;
  if (isClaimFresh(claim, now)) {
    await runFollowerCleanup();
    return;
  }

  // Esta pestaña se vuelve "líder": es la única que llama al logout real.
  localStorage.setItem(IDLE_LOGOUT_CLAIM_KEY, String(now));
  idleLogoutInProgress = true;
  stop();
  const auth = useAuthStore();
  try {
    await auth.logout();
  } finally {
    await router.push({ name: "login", query: { expirada: "inactividad" } });
  }
}

function tick(): void {
  if (idleLogoutInProgress) return;
  const now = Date.now();
  const phase = getIdlePhase(lastActivityLocal, now);
  if (phase === "active") {
    state.showWarning = false;
  } else if (phase === "warning") {
    state.showWarning = true;
    state.secondsRemaining = secondsUntilLogout(lastActivityLocal, now);
  } else {
    void triggerIdleLogout();
  }
}

function onStorageEvent(e: StorageEvent): void {
  if (e.key === LAST_ACTIVITY_KEY && e.newValue) {
    lastActivityLocal = Number(e.newValue);
    state.showWarning = false;
  } else if (e.key === IDLE_LOGOUT_CLAIM_KEY && e.newValue) {
    void runFollowerCleanup();
  }
}

function start(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  idleLogoutInProgress = false;

  const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || null;
  lastActivityLocal = resolveSeedActivity(stored, Date.now());

  for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, recordActivity, { passive: true });
  // El scroll real ocurre en el contenedor interno `overflow-y-auto` de
  // `AppLayout.vue`, no en `window`; scroll no burbujea pero sí es observable
  // en fase de captura sobre un ancestro.
  window.addEventListener("scroll", recordActivity, { passive: true, capture: true });
  window.addEventListener("storage", onStorageEvent);

  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
}

function stop(): void {
  if (!listenersAttached) return;
  listenersAttached = false;

  for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, recordActivity);
  window.removeEventListener("scroll", recordActivity, { capture: true });
  window.removeEventListener("storage", onStorageEvent);

  if (tickTimer) clearInterval(tickTimer);
  tickTimer = undefined;
  state.showWarning = false;
}

/** Ping autenticado real: si la cookie ya murió en el servidor, el interceptor de 401 en `lib/directus.ts` se encarga. */
async function stayConnected(): Promise<void> {
  broadcastActivityNow();
  try {
    await directus.request(readMe({ fields: ["id"] }));
  } catch {
    // Sesión ya muerta: `handleExpiredSession` ya se disparó desde el interceptor.
  }
}

/** Se llama una sola vez, desde `App.vue`: arranca/para el timer según haya sesión. */
export function useIdleTimeout(): void {
  if (started) return;
  started = true;

  const auth = useAuthStore();
  watch(
    () => auth.isAuthenticated,
    (isAuth) => {
      if (isAuth) start();
      else {
        stop();
        idleLogoutInProgress = false;
      }
    },
    { immediate: true },
  );

  onUnmounted(stop);
}

export function useIdleTimeoutState() {
  return { state: readonly(state), stayConnected };
}
