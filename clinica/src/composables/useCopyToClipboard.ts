import { onUnmounted, ref } from "vue";

/**
 * Copiar al portapapeles con feedback en el propio botón: el panel no tiene
 * sistema de toasts, así que `copiedKey` guarda la clave del ítem recién copiado
 * y solo ese botón cambia su texto a "¡Copiado!" durante unos segundos.
 */
export function useCopyToClipboard(resetMs = 1800) {
  const copiedKey = ref<string | null>(null);
  const copyError = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * `navigator.clipboard` solo existe en contexto seguro (https o localhost). El
   * dev server se corre con `--host`, que sirve el panel por http en la IP de la
   * LAN, donde esa API no está disponible: de ahí este camino alternativo.
   */
  function legacyCopy(text: string): boolean {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  async function copy(text: string, key: string): Promise<boolean> {
    copyError.value = null;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else {
        ok = legacyCopy(text);
      }
    } catch {
      ok = legacyCopy(text);
    }

    if (ok) {
      copiedKey.value = key;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        copiedKey.value = null;
      }, resetMs);
    } else {
      copyError.value = "No se pudo copiar automáticamente. Seleccione el texto y use Ctrl+C.";
    }
    return ok;
  }

  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });

  return { copiedKey, copyError, copy };
}
