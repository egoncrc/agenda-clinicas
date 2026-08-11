/**
 * Textos que la recepción copia y envía a mano mientras la cuenta de WhatsApp
 * Business sigue bloqueada por Meta. No pasan por la API: no son plantillas HSM
 * y no tienen que respetar ningún formato aprobado, son texto libre.
 *
 * Módulo puro: recibe los datos ya formateados (la vista hace el `formatDay` /
 * `formatTime` con Luxon) para no tener que conocer la zona horaria de la clínica.
 *
 * Registro: usted, cordial y sin emojis. "Usted" es la norma de servicio en Costa
 * Rica y coincide con la voz del bot; los emojis se degradan al pegar en SMS.
 */

/** Solo el primer nombre, para que el saludo suene natural ("Hola, María" y no el nombre completo). */
function primerNombre(nombre: string | null | undefined): string | null {
  const limpio = nombre?.trim();
  if (!limpio) return null;
  return limpio.split(/\s+/)[0] ?? null;
}

/**
 * Sin franja horaria a propósito: un "buenos días" fijo envejece mal, porque la
 * recepción puede copiar el mismo texto a las 3 p.m. Sin nombre se saluda a secas,
 * para no terminar escribiendo "Hola, +50688887777" a un paciente que el bot creó
 * solo con el teléfono.
 */
function saludo(pacienteNombre: string | null | undefined, clinicaNombre: string): string {
  const n = primerNombre(pacienteNombre);
  return n ? `Hola, ${n}. Le saludamos de ${clinicaNombre}.` : `Hola. Le saludamos de ${clinicaNombre}.`;
}

export interface ConfirmationMessageInput {
  clinicaNombre: string;
  pacienteNombre: string | null;
  servicioNombre: string;
  /** Opcional: la tabla de citas la incluye, la pantalla Mensajes no. */
  especialidadNombre?: string | null;
  doctorNombre: string;
  /** "martes 29 de julio" — formatDay() de @/lib/dateRanges. */
  fechaTexto: string;
  /** "10:30" — formatTime() de @/lib/dateRanges. */
  horaTexto: string;
}

export function buildConfirmationMessage(i: ConfirmationMessageInput): string {
  return [
    saludo(i.pacienteNombre, i.clinicaNombre),
    "",
    `Le recordamos su cita de ${i.servicioNombre}${i.especialidadNombre ? ` (${i.especialidadNombre})` : ""} con ${i.doctorNombre} el ${i.fechaTexto} a las ${i.horaTexto}.`,
    "",
    "¿Nos confirma si puede asistir? Si necesita cambiarla, con gusto le buscamos otro espacio.",
    "",
    "¡Muchas gracias!",
  ].join("\n");
}

export interface RecallMessageInput {
  clinicaNombre: string;
  pacienteNombre: string | null;
  servicioNombre: string;
  recallMeses: number;
  /** "12 de enero" — fecha de la última visita, ya formateada por la vista. */
  ultimaVisitaTexto: string;
}

export function buildRecallMessage(i: RecallMessageInput): string {
  // "su cita de {servicio} del {fecha}" en vez de "su última {servicio}": el nombre
  // del servicio es texto libre, así que no se puede inferir su género para concordar
  // el artículo ("su última Control" saldría mal).
  return [
    saludo(i.pacienteNombre, i.clinicaNombre),
    "",
    `Ya casi se cumplen ${i.recallMeses} meses desde su cita de ${i.servicioNombre} del ${i.ultimaVisitaTexto}. Es buen momento para agendar la siguiente y mantener su salud dental al día.`,
    "",
    "¿Le buscamos un espacio esta semana o la próxima? Cuéntenos qué día y a qué hora le queda mejor y se lo apartamos.",
    "",
    "¡Quedamos atentos!",
  ].join("\n");
}

export interface CancellationMessageInput {
  clinicaNombre: string;
  pacienteNombre: string | null;
  servicioNombre: string;
  doctorNombre: string;
  /** "martes 29 de julio" — formatDay() de @/lib/dateRanges. */
  fechaTexto: string;
  /** "10:30" — formatTime() de @/lib/dateRanges. */
  horaTexto: string;
}

/**
 * Aviso de que la cita se canceló porque el médico dejó de atender ese horario:
 * una ausencia registrada sobre esa fecha o un cambio en su horario laboral. La
 * fórmula cubre las dos causas a propósito — al paciente le da igual cuál fue, y
 * el motivo exacto queda en `motivo_cancelacion` para el reporte.
 *
 * No se detalla el motivo (es información del profesional, y "vacaciones" suena
 * peor que "imprevisto" a quien pierde su cita) y se cierra abriendo el
 * reagendado, que es lo que la recepción necesita que pase después.
 */
export function buildCancellationMessage(i: CancellationMessageInput): string {
  return [
    saludo(i.pacienteNombre, i.clinicaNombre),
    "",
    `Lamentamos informarle que debemos cancelar su cita de ${i.servicioNombre} con ${i.doctorNombre} del ${i.fechaTexto} a las ${i.horaTexto}, por un cambio imprevisto en la agenda del profesional.`,
    "",
    "Le ofrecemos disculpas por el inconveniente. Con gusto le reagendamos: cuéntenos qué día y a qué hora le queda mejor y se lo apartamos.",
    "",
    "¡Quedamos atentos!",
  ].join("\n");
}

/** Código de país para teléfonos guardados en formato local viejo, sin prefijo. */
const DEFAULT_COUNTRY_CODE = "506";

/**
 * `wa.me` NO es la API de Meta: abre el WhatsApp del propio usuario (web o app)
 * con el chat y el texto ya cargados, y el envío lo hace la persona a mano. Por
 * eso sigue funcionando con la WABA bloqueada.
 *
 * El path solo admite dígitos con código de país, sin "+" ni separadores.
 * Devuelve `null` con un teléfono inservible, para que la vista pueda deshabilitar
 * el botón en vez de ofrecer un link roto.
 */
export function waMeLink(telefonoE164: string | null | undefined, mensaje: string): string | null {
  let digits = (telefonoE164 ?? "").replace(/\D/g, "");
  if (digits.length === 8) digits = DEFAULT_COUNTRY_CODE + digits;
  if (digits.length < 10) return null;
  // encodeURIComponent deja los saltos de línea como %0A, que WhatsApp interpreta bien.
  return `https://wa.me/${digits}?text=${encodeURIComponent(mensaje)}`;
}
