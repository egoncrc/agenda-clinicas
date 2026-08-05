import { reactive, readonly } from "vue";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warn";
}

interface ConfirmState extends Required<ConfirmOptions> {
  open: boolean;
}

const state = reactive<ConfirmState>({
  open: false,
  title: "",
  message: "",
  confirmLabel: "Eliminar",
  cancelLabel: "Cancelar",
  tone: "danger",
});

let resolvePromise: ((value: boolean) => void) | null = null;

function settle(value: boolean): void {
  state.open = false;
  resolvePromise?.(value);
  resolvePromise = null;
}

function handleConfirm(): void {
  settle(true);
}

function handleCancel(): void {
  settle(false);
}

/**
 * Resuelve a `true`/`false` según la elección del usuario en el modal
 * global, en vez del `confirm()` nativo del navegador. Solo puede haber un
 * diálogo de confirmación abierto a la vez (estado singleton).
 */
export function useConfirm() {
  return function confirm(options: ConfirmOptions): Promise<boolean> {
    state.title = options.title;
    state.message = options.message;
    state.confirmLabel = options.confirmLabel ?? "Eliminar";
    state.cancelLabel = options.cancelLabel ?? "Cancelar";
    state.tone = options.tone ?? "danger";
    state.open = true;
    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  };
}

export function useConfirmDialogState() {
  return { state: readonly(state), handleConfirm, handleCancel };
}
