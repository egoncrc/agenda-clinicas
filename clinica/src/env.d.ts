/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DIRECTUS_URL: string;
  /** Opcional: si falta, `stores/auth.ts` cae en `${window.location.origin}/restablecer`. */
  readonly VITE_PASSWORD_RESET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
