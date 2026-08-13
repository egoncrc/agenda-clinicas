import { describe, expect, it } from "vitest";
import { bookingLink, buildCancellationMessage, buildConfirmationMessage, buildRecallMessage } from "./messageTemplates";

describe("buildConfirmationMessage", () => {
  const base = {
    clinicaNombre: "Servicios Médicos Santa Lucía",
    pacienteNombre: "Esteban Gonzalez",
    servicioNombre: "Consulta de Valoración",
    especialidadNombre: "Odontología",
    doctorNombre: "Dr. Rodolfo Sánchez",
    fechaTexto: "jueves 13 de agosto",
    horaTexto: "11:00 AM",
    telefonoContacto: "2222-3344",
  };

  it("saluda con el primer nombre del paciente", () => {
    expect(buildConfirmationMessage(base)).toContain(
      "Hola Esteban, le saludamos de parte de la clínica Servicios Médicos Santa Lucía.",
    );
  });

  it("saluda sin nombre si el paciente no tiene uno registrado", () => {
    const mensaje = buildConfirmationMessage({ ...base, pacienteNombre: null });
    expect(mensaje).toContain("Hola. Le saludamos de parte de la clínica Servicios Médicos Santa Lucía.");
  });

  it("incluye servicio, especialidad, doctor, fecha y hora", () => {
    expect(buildConfirmationMessage(base)).toContain(
      "Consulta de Valoración (Odontología) con Dr. Rodolfo Sánchez el jueves 13 de agosto a las 11:00 AM",
    );
  });

  it("incluye el teléfono de contacto en el cierre", () => {
    expect(buildConfirmationMessage(base)).toContain("teléfono 2222-3344");
  });
});

describe("buildCancellationMessage", () => {
  const base = {
    clinicaNombre: "Servicios Médicos Santa Lucía",
    pacienteNombre: "Scott",
    servicioNombre: "Limpieza Dental",
    doctorNombre: "Dr. Rodolfo Sánchez",
    fechaTexto: "lunes 10 de agosto",
    horaTexto: "09:00 AM",
    telefonoContacto: "2222-3344",
    enlaceAgendar: "https://panel.egonia.site/agendar?clinica=abc123",
  };

  it("incluye el motivo, servicio, doctor, fecha y hora", () => {
    expect(buildCancellationMessage(base)).toContain(
      "cancelar su cita de Limpieza Dental del lunes 10 de agosto a las 09:00 AM",
    );
  });

  it("incluye el enlace de agendar y el teléfono de contacto", () => {
    const mensaje = buildCancellationMessage(base);
    expect(mensaje).toContain("https://panel.egonia.site/agendar?clinica=abc123");
    expect(mensaje).toContain("teléfono 2222-3344");
  });
});

describe("buildRecallMessage", () => {
  it("usa el mismo saludo nuevo", () => {
    const mensaje = buildRecallMessage({
      clinicaNombre: "Santa Lucía",
      pacienteNombre: "María",
      servicioNombre: "Control",
      recallMeses: 6,
      ultimaVisitaTexto: "12 de enero",
    });
    expect(mensaje).toContain("Hola María, le saludamos de parte de la clínica Santa Lucía.");
  });
});

describe("bookingLink", () => {
  it("arma la URL con el id de la clínica", () => {
    expect(bookingLink("abc123")).toBe("https://panel.egonia.site/agendar?clinica=abc123");
  });
});
