/** Lógica pura de cierre de sesión por inactividad. Sin Vue ni DOM: ver `composables/useIdleTimeout.ts` para el pegamento. */

export const IDLE_LIMIT_MS = 60 * 60 * 1000;
export const WARNING_LEAD_MS = 60 * 1000;
export const TICK_INTERVAL_MS = 1000;
export const ACTIVITY_WRITE_THROTTLE_MS = 5000;
export const LEADER_CLAIM_TTL_MS = 30 * 1000;

/** Mismo prefijo `clinica-dental:` que ya usa `stores/clinica.ts`, pero en localStorage: el contador se comparte entre pestañas. */
export const LAST_ACTIVITY_KEY = "clinica-dental:lastActivity";
export const IDLE_LOGOUT_CLAIM_KEY = "clinica-dental:idleLogoutClaim";

export type IdlePhase = "active" | "warning" | "expired";

export function getIdlePhase(lastActivity: number, now: number): IdlePhase {
  const elapsed = now - lastActivity;
  if (elapsed >= IDLE_LIMIT_MS) return "expired";
  if (elapsed >= IDLE_LIMIT_MS - WARNING_LEAD_MS) return "warning";
  return "active";
}

export function secondsUntilLogout(lastActivity: number, now: number): number {
  return Math.max(0, Math.ceil((IDLE_LIMIT_MS - (now - lastActivity)) / 1000));
}

export function isClaimFresh(claimTimestamp: number | null, now: number): boolean {
  return claimTimestamp !== null && now - claimTimestamp < LEADER_CLAIM_TTL_MS;
}

/**
 * Si el valor guardado ya es de una sesión vieja (más de una hora) o no existe,
 * arranca "de cero" en `now`. Evita tener que limpiar `LAST_ACTIVITY_KEY` a mano
 * en login/logout: un timestamp añejo nunca se confunde con actividad reciente.
 */
export function resolveSeedActivity(storedValue: number | null, now: number): number {
  if (storedValue === null || now - storedValue >= IDLE_LIMIT_MS) return now;
  return storedValue;
}
