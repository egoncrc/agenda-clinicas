import { describe, it, expect } from "vitest";
import { computeOccupancy } from "./occupancy";
import type { OccupancyInput } from "./occupancy";

const TZ = "America/Costa_Rica";

/** Lunes 6 de abril de 2026, 00:00 a 23:59:59 hora de Costa Rica (UTC-6). */
const LUNES = {
  desde: "2026-04-06T00:00:00.000-06:00",
  hasta: "2026-04-06T23:59:59.999-06:00",
};

function input(over: Partial<OccupancyInput> = {}): OccupancyInput {
  return {
    ...LUNES,
    timezone: TZ,
    workingHours: [],
    timeOff: [],
    appointments: [],
    ...over,
  };
}

/** Horario de 08:00 a 12:00 los lunes = 4 horas de agenda. */
const LUNES_MANANA = {
  doctor: "doc-1",
  dia_semana: 1,
  hora_inicio: "08:00:00",
  hora_fin: "12:00:00",
};

describe("computeOccupancy", () => {
  it("proyecta el horario semanal sobre los días del rango", () => {
    const r = computeOccupancy(input({ workingHours: [LUNES_MANANA] }));
    expect(r.totales.minutosDisponibles).toBe(240);
    expect(r.totales.minutosOcupados).toBe(0);
  });

  it("ignora los horarios cuyo día de la semana no cae en el rango", () => {
    // dia_semana 3 = miércoles; el rango es un lunes.
    const r = computeOccupancy(
      input({ workingHours: [{ ...LUNES_MANANA, dia_semana: 3 }] }),
    );
    expect(r.totales.minutosDisponibles).toBe(0);
  });

  it("acumula el horario a lo largo de varias semanas", () => {
    // Del lunes 6 al lunes 20 de abril: tres lunes.
    const r = computeOccupancy(
      input({
        desde: "2026-04-06T00:00:00.000-06:00",
        hasta: "2026-04-20T23:59:59.999-06:00",
        workingHours: [LUNES_MANANA],
      }),
    );
    expect(r.totales.minutosDisponibles).toBe(240 * 3);
  });

  it("descuenta las ausencias que pisan el horario", () => {
    const r = computeOccupancy(
      input({
        workingHours: [LUNES_MANANA],
        timeOff: [
          { doctor: "doc-1", inicio: "2026-04-06T10:00:00-06:00", fin: "2026-04-06T12:00:00-06:00" },
        ],
      }),
    );
    expect(r.totales.minutosDisponibles).toBe(120);
  });

  it("descuenta solo la parte de la ausencia que solapa el horario", () => {
    // Ausencia de 06:00 a 09:00: solo la hora de 08:00 a 09:00 estaba en agenda.
    const r = computeOccupancy(
      input({
        workingHours: [LUNES_MANANA],
        timeOff: [
          { doctor: "doc-1", inicio: "2026-04-06T06:00:00-06:00", fin: "2026-04-06T09:00:00-06:00" },
        ],
      }),
    );
    expect(r.totales.minutosDisponibles).toBe(180);
  });

  it("no cuenta dos veces los tramos de horario solapados", () => {
    // El mismo médico con dos filas que se pisan (dos sedes mal cargadas):
    // 08-12 y 10-14 son 6 horas de reloj, no 8.
    const r = computeOccupancy(
      input({
        workingHours: [
          LUNES_MANANA,
          { doctor: "doc-1", dia_semana: 1, hora_inicio: "10:00:00", hora_fin: "14:00:00" },
        ],
      }),
    );
    expect(r.totales.minutosDisponibles).toBe(360);
  });

  it("calcula la ocupación de las citas dentro del horario", () => {
    const r = computeOccupancy(
      input({
        workingHours: [LUNES_MANANA],
        appointments: [
          { doctor: "doc-1", inicio: "2026-04-06T09:00:00-06:00", fin: "2026-04-06T10:00:00-06:00" },
        ],
      }),
    );
    expect(r.totales.minutosOcupados).toBe(60);
    expect(r.totales.minutosFueraDeHorario).toBe(0);
    expect(r.totales.citas).toBe(1);
  });

  it("no deja que una cita fuera de horario empuje la ocupación por encima del 100%", () => {
    // 4 horas de agenda y una cita de 07:00 a 08:00, antes de abrir.
    const r = computeOccupancy(
      input({
        workingHours: [LUNES_MANANA],
        appointments: [
          { doctor: "doc-1", inicio: "2026-04-06T07:00:00-06:00", fin: "2026-04-06T08:00:00-06:00" },
        ],
      }),
    );
    expect(r.totales.minutosOcupados).toBe(0);
    expect(r.totales.minutosFueraDeHorario).toBe(60);
    expect(r.totales.minutosOcupados).toBeLessThanOrEqual(r.totales.minutosDisponibles);
  });

  it("parte una cita a caballo del cierre entre ocupado y fuera de horario", () => {
    // 11:30 a 12:30 con cierre a las 12:00: media hora de cada cosa.
    const r = computeOccupancy(
      input({
        workingHours: [LUNES_MANANA],
        appointments: [
          { doctor: "doc-1", inicio: "2026-04-06T11:30:00-06:00", fin: "2026-04-06T12:30:00-06:00" },
        ],
      }),
    );
    expect(r.totales.minutosOcupados).toBe(30);
    expect(r.totales.minutosFueraDeHorario).toBe(30);
  });

  it("cuenta como fuera de horario la cita que cae dentro de una ausencia", () => {
    const r = computeOccupancy(
      input({
        workingHours: [LUNES_MANANA],
        timeOff: [
          { doctor: "doc-1", inicio: "2026-04-06T09:00:00-06:00", fin: "2026-04-06T10:00:00-06:00" },
        ],
        appointments: [
          { doctor: "doc-1", inicio: "2026-04-06T09:00:00-06:00", fin: "2026-04-06T10:00:00-06:00" },
        ],
      }),
    );
    expect(r.totales.minutosDisponibles).toBe(180);
    expect(r.totales.minutosOcupados).toBe(0);
    expect(r.totales.minutosFueraDeHorario).toBe(60);
  });

  it("separa a cada médico y no mezcla sus horarios ni sus citas", () => {
    const r = computeOccupancy(
      input({
        workingHours: [LUNES_MANANA, { ...LUNES_MANANA, doctor: "doc-2" }],
        appointments: [
          { doctor: "doc-1", inicio: "2026-04-06T09:00:00-06:00", fin: "2026-04-06T10:00:00-06:00" },
        ],
      }),
    );
    const doc1 = r.porMedico.find((d) => d.doctorId === "doc-1")!;
    const doc2 = r.porMedico.find((d) => d.doctorId === "doc-2")!;
    expect(doc1.minutosOcupados).toBe(60);
    expect(doc2.minutosOcupados).toBe(0);
    expect(doc2.minutosDisponibles).toBe(240);
  });

  it("incluye al médico con citas pero sin horario cargado", () => {
    const r = computeOccupancy(
      input({
        appointments: [
          { doctor: "doc-9", inicio: "2026-04-06T09:00:00-06:00", fin: "2026-04-06T10:00:00-06:00" },
        ],
      }),
    );
    const doc9 = r.porMedico.find((d) => d.doctorId === "doc-9")!;
    expect(doc9.minutosDisponibles).toBe(0);
    expect(doc9.minutosFueraDeHorario).toBe(60);
  });

  it("reparte los minutos disponibles entre las horas del día que toca", () => {
    const r = computeOccupancy(
      input({
        workingHours: [{ doctor: "doc-1", dia_semana: 1, hora_inicio: "09:30:00", hora_fin: "11:00:00" }],
      }),
    );
    const porHora = new Map(r.porHora.map((b) => [b.hora, b]));
    expect(porHora.get(9)!.minutosDisponibles).toBe(30);
    expect(porHora.get(10)!.minutosDisponibles).toBe(60);
    expect(porHora.has(11)).toBe(false);
  });

  it("imputa la cita a la hora en que empieza, para las horas pico", () => {
    const r = computeOccupancy(
      input({
        workingHours: [LUNES_MANANA],
        appointments: [
          { doctor: "doc-1", inicio: "2026-04-06T09:45:00-06:00", fin: "2026-04-06T10:15:00-06:00" },
        ],
      }),
    );
    const porHora = new Map(r.porHora.map((b) => [b.hora, b]));
    expect(porHora.get(9)!.citas).toBe(1);
    expect(porHora.get(10)!.citas).toBe(0);
    // Los minutos sí se reparten entre ambas horas.
    expect(porHora.get(9)!.minutosOcupados).toBe(15);
    expect(porHora.get(10)!.minutosOcupados).toBe(15);
  });

  it("recorta al rango la cita que se sale por el borde", () => {
    // Rango de un solo día; la cita empieza a las 23:30 y termina al día siguiente.
    const r = computeOccupancy(
      input({
        workingHours: [{ doctor: "doc-1", dia_semana: 1, hora_inicio: "23:00:00", hora_fin: "23:59:00" }],
        appointments: [
          { doctor: "doc-1", inicio: "2026-04-06T23:30:00-06:00", fin: "2026-04-07T00:30:00-06:00" },
        ],
      }),
    );
    // Solo los 29 minutos que caben dentro del horario del día consultado.
    expect(r.totales.minutosOcupados).toBe(29);
  });

  it("descarta filas con horarios inválidos en vez de reventar", () => {
    const r = computeOccupancy(
      input({
        workingHours: [
          { doctor: "doc-1", dia_semana: 1, hora_inicio: "12:00:00", hora_fin: "08:00:00" },
          { doctor: "doc-1", dia_semana: 1, hora_inicio: "no-es-hora", hora_fin: "12:00:00" },
        ],
      }),
    );
    expect(r.totales.minutosDisponibles).toBe(0);
  });
});
