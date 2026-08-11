/**
 * Un paciente no puede estar en dos consultas a la vez EN LA MISMA CLÍNICA,
 * sin importar el médico o la especialidad. A diferencia del solape por
 * médico (que aplica el `buffer_min` del servicio como tiempo de preparación),
 * este es overlap estricto de `inicio`/`fin`: el buffer es tiempo del médico,
 * no del paciente. Semiabierto (`[inicio, fin)`), mismo criterio que el resto
 * de los chequeos de agenda: dos citas contiguas no cuentan como solapadas.
 */
export interface AppointmentRange {
  inicio: string;
  fin: string;
}

export function overlapsAnyAppointment(
  candidate: { inicio: Date; fin: Date },
  appointments: AppointmentRange[],
): boolean {
  const start = candidate.inicio.getTime();
  const end = candidate.fin.getTime();
  return appointments.some((a) => {
    const aStart = new Date(a.inicio).getTime();
    const aEnd = new Date(a.fin).getTime();
    return start < aEnd && aStart < end;
  });
}
