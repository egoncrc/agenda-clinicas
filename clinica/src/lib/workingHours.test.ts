import { describe, it, expect } from "vitest";
import {
  appointmentHitsRemoved,
  mergeRanges,
  overlappingBlock,
  removedIntervalsByDay,
  subtractRanges,
} from "./workingHours";
import type { HoursBlock } from "./workingHours";
import { CLINIC_TIMEZONE } from "./dateRanges";

/** Lunes = 1. Directus devuelve "HH:mm:ss"; el formulario, "HH:mm". Ambos deben valer. */
function bloque(dia: number, inicio: string, fin: string): HoursBlock {
  return { dia_semana: dia as HoursBlock["dia_semana"], hora_inicio: inicio, hora_fin: fin };
}

const LUNES_8_12 = bloque(1, "08:00:00", "12:00:00");

/** Lunes 6 de abril de 2026 en hora de Costa Rica (UTC-6, sin horario de verano). */
function cita(horaInicio: string, horaFin: string) {
  return {
    inicio: `2026-04-06T${horaInicio}:00.000-06:00`,
    fin: `2026-04-06T${horaFin}:00.000-06:00`,
  };
}

describe("mergeRanges", () => {
  it("funde tramos solapados y contiguos", () => {
    expect(mergeRanges([{ inicio: 480, fin: 660 }, { inicio: 600, fin: 720 }])).toEqual([{ inicio: 480, fin: 720 }]);
    expect(mergeRanges([{ inicio: 480, fin: 660 }, { inicio: 660, fin: 780 }])).toEqual([{ inicio: 480, fin: 780 }]);
  });

  it("deja separados los tramos con hueco entre medias", () => {
    expect(mergeRanges([{ inicio: 660, fin: 780 }, { inicio: 480, fin: 600 }])).toEqual([
      { inicio: 480, fin: 600 },
      { inicio: 660, fin: 780 },
    ]);
  });
});

describe("subtractRanges", () => {
  it("recorta por el inicio y por el final", () => {
    expect(subtractRanges([{ inicio: 480, fin: 720 }], [{ inicio: 540, fin: 720 }])).toEqual([
      { inicio: 480, fin: 540 },
    ]);
    expect(subtractRanges([{ inicio: 480, fin: 720 }], [{ inicio: 480, fin: 660 }])).toEqual([
      { inicio: 660, fin: 720 },
    ]);
  });

  it("parte el tramo en dos cuando lo restado queda en medio", () => {
    expect(subtractRanges([{ inicio: 480, fin: 720 }], [{ inicio: 540, fin: 600 }])).toEqual([
      { inicio: 480, fin: 540 },
      { inicio: 600, fin: 720 },
    ]);
  });

  it("devuelve vacío cuando lo que queda cubre todo", () => {
    expect(subtractRanges([{ inicio: 480, fin: 720 }], [{ inicio: 420, fin: 780 }])).toEqual([]);
  });
});

describe("removedIntervalsByDay", () => {
  it("crear un bloque no elimina nada", () => {
    const after = [LUNES_8_12, bloque(2, "08:00", "12:00")];
    expect(removedIntervalsByDay([LUNES_8_12], after).size).toBe(0);
  });

  it("ampliar un bloque no elimina nada", () => {
    const after = [bloque(1, "07:00", "13:00")];
    expect(removedIntervalsByDay([LUNES_8_12], after).size).toBe(0);
  });

  it("recortar el inicio elimina solo la punta", () => {
    const removed = removedIntervalsByDay([LUNES_8_12], [bloque(1, "09:00", "12:00")]);
    expect(removed.get(1)).toEqual([{ inicio: 480, fin: 540 }]);
  });

  it("recortar el fin elimina solo la cola", () => {
    const removed = removedIntervalsByDay([LUNES_8_12], [bloque(1, "08:00", "11:00")]);
    expect(removed.get(1)).toEqual([{ inicio: 660, fin: 720 }]);
  });

  it("mover el bloque a otro día lo elimina entero del día viejo", () => {
    const removed = removedIntervalsByDay([LUNES_8_12], [bloque(2, "08:00", "12:00")]);
    expect(removed.get(1)).toEqual([{ inicio: 480, fin: 720 }]);
    expect(removed.has(2)).toBe(false);
  });

  it("eliminar un bloque no toca lo que cubre otro bloque del mismo día", () => {
    const antes = [bloque(1, "08:00", "11:00"), bloque(1, "10:00", "13:00")];
    // Se borra el primero: 08–10 deja de estar cubierto, 10–11 lo sigue cubriendo el otro.
    const removed = removedIntervalsByDay(antes, [bloque(1, "10:00", "13:00")]);
    expect(removed.get(1)).toEqual([{ inicio: 480, fin: 600 }]);
  });

  it("con bloques duplicados no cuenta el mismo tramo dos veces", () => {
    const antes = [LUNES_8_12, bloque(1, "08:00", "12:00")];
    const removed = removedIntervalsByDay(antes, [bloque(1, "08:00", "12:00")]);
    expect(removed.size).toBe(0);
  });

  it("borrar el único bloque del día elimina el día entero", () => {
    const removed = removedIntervalsByDay([LUNES_8_12], []);
    expect(removed.get(1)).toEqual([{ inicio: 480, fin: 720 }]);
  });
});

describe("overlappingBlock", () => {
  it("detecta la superposición parcial", () => {
    expect(overlappingBlock(bloque(1, "10:00", "12:00"), [bloque(1, "08:00", "11:00")])).not.toBeNull();
  });

  it("dos bloques contiguos no se superponen", () => {
    expect(overlappingBlock(bloque(1, "11:00", "13:00"), [bloque(1, "08:00", "11:00")])).toBeNull();
  });

  it("ignora los bloques de otro día", () => {
    expect(overlappingBlock(bloque(2, "10:00", "12:00"), [bloque(1, "08:00", "11:00")])).toBeNull();
  });

  it("detecta el bloque que contiene por completo al candidato", () => {
    expect(overlappingBlock(bloque(1, "09:00", "10:00"), [LUNES_8_12])).not.toBeNull();
  });
});

describe("appointmentHitsRemoved", () => {
  const removed = removedIntervalsByDay([LUNES_8_12], [bloque(1, "09:00", "12:00")]); // se pierde 08:00–09:00

  it("marca la cita que cae dentro del tramo eliminado", () => {
    expect(appointmentHitsRemoved(cita("08:15", "08:45"), removed, CLINIC_TIMEZONE)).toBe(true);
  });

  it("marca la cita que lo pisa solo en parte", () => {
    expect(appointmentHitsRemoved(cita("08:45", "09:30"), removed, CLINIC_TIMEZONE)).toBe(true);
  });

  it("no marca la cita que empieza justo donde acaba el tramo eliminado", () => {
    expect(appointmentHitsRemoved(cita("09:00", "09:30"), removed, CLINIC_TIMEZONE)).toBe(false);
  });

  it("no marca una cita de otro día de la semana", () => {
    const martes = { inicio: "2026-04-07T08:15:00.000-06:00", fin: "2026-04-07T08:45:00.000-06:00" };
    expect(appointmentHitsRemoved(martes, removed, CLINIC_TIMEZONE)).toBe(false);
  });

  it("no marca nada cuando no se eliminó ningún tramo", () => {
    const sinCambios = removedIntervalsByDay([LUNES_8_12], [LUNES_8_12]);
    expect(appointmentHitsRemoved(cita("08:15", "08:45"), sinCambios, CLINIC_TIMEZONE)).toBe(false);
  });

  it("una cita fuera de horario desde antes no se ve afectada por el recorte", () => {
    // 07:00 nunca estuvo dentro del horario, así que quitar 08:00–09:00 no la rompe.
    expect(appointmentHitsRemoved(cita("07:00", "07:30"), removed, CLINIC_TIMEZONE)).toBe(false);
  });
});

/**
 * Calcados de los datos reales de producción, que es donde se reportó que editar
 * "no avisaba". El médico tiene el martes partido en dos bloques y una cita a
 * las 17:00; el lunes arrastra dos bloques superpuestos cargados antes de que la
 * regla existiera.
 */
describe("casos reales de producción", () => {
  const MARTES = [bloque(2, "15:00:00", "17:30:00"), bloque(2, "18:00:00", "20:00:00")];
  /** 25/8/2026 es martes; 17:00–18:00 hora de Costa Rica. */
  const CITA_MARTES = { inicio: "2026-08-25T23:00:00.000Z", fin: "2026-08-26T00:00:00.000Z" };

  it("editar 15:00–17:30 a 15:00–17:00 marca la cita de las 17:00", () => {
    const despues = [bloque(2, "15:00:00", "17:00:00"), MARTES[1]!];
    const removed = removedIntervalsByDay(MARTES, despues);
    expect(removed.get(2)).toEqual([{ inicio: 17 * 60, fin: 17 * 60 + 30 }]);
    expect(appointmentHitsRemoved(CITA_MARTES, removed, CLINIC_TIMEZONE)).toBe(true);
  });

  it("editar el bloque de la tarde no toca la cita de la mañana del mismo día", () => {
    const despues = [MARTES[0]!, bloque(2, "19:00:00", "20:00:00")];
    const removed = removedIntervalsByDay(MARTES, despues);
    expect(appointmentHitsRemoved(CITA_MARTES, removed, CLINIC_TIMEZONE)).toBe(false);
  });

  it("detecta el par heredado lunes 09:00–11:00 dentro de 08:00–17:00", () => {
    const grande = bloque(1, "08:00:00", "17:00:00");
    const chico = bloque(1, "09:00:00", "11:00:00");
    expect(overlappingBlock(chico, [grande])).toBe(grande);
    expect(overlappingBlock(grande, [chico])).toBe(chico);
  });

  it("borrar el bloque grande del par heredado deja fuera lo que el chico no cubre", () => {
    const antes = [bloque(1, "08:00:00", "17:00:00"), bloque(1, "09:00:00", "11:00:00")];
    const removed = removedIntervalsByDay(antes, [bloque(1, "09:00:00", "11:00:00")]);
    expect(removed.get(1)).toEqual([
      { inicio: 8 * 60, fin: 9 * 60 },
      { inicio: 11 * 60, fin: 17 * 60 },
    ]);
  });
});
