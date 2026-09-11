import { describe, expect, it } from "vitest";
import { cancelledByRole } from "./appointmentStatus";

describe("cancelledByRole", () => {
  it("admin gana sobre cualquier otro rol", () => {
    expect(cancelledByRole({ isAdmin: true, isReceptionist: false })).toBe("admin");
    // Un admin también puede tener el flag de recepción; el más alto manda.
    expect(cancelledByRole({ isAdmin: true, isReceptionist: true })).toBe("admin");
  });

  it("recepción cuando no es admin", () => {
    expect(cancelledByRole({ isAdmin: false, isReceptionist: true })).toBe("recepcion");
  });

  it("médico es el caso por defecto (ni admin ni recepción)", () => {
    expect(cancelledByRole({ isAdmin: false, isReceptionist: false })).toBe("medico");
  });

  it("nunca devuelve 'paciente': eso solo lo origina el bot de WhatsApp", () => {
    const combos = [
      { isAdmin: false, isReceptionist: false },
      { isAdmin: false, isReceptionist: true },
      { isAdmin: true, isReceptionist: false },
      { isAdmin: true, isReceptionist: true },
    ];
    for (const auth of combos) {
      expect(cancelledByRole(auth)).not.toBe("paciente");
    }
  });
});
