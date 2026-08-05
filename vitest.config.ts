import { defineConfig } from "vitest/config";

/**
 * Los tests del bot (`src/**`) y los del panel (`clinica/src/**`) son dos suites
 * independientes, con dependencias y alias distintos: `clinica/` resuelve `@/`
 * contra su propio `vite.config.ts`, que este proceso no carga. Sin esta
 * exclusión, `npm test` desde la raíz arrastra los archivos del panel y falla al
 * resolverles los imports.
 *
 * El panel se prueba con `npm test` dentro de `clinica/`.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "clinica/**", "directus-extensions/**"],
  },
});
