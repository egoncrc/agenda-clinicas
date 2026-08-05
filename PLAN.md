# Plan de implementación — Chatbot de WhatsApp para agenda de clínica dental

Stack definido:
- **Backend de datos:** Directus (ya desplegado en servidor propio de DigitalOcean) — provee la base de datos (PostgreSQL), API REST/GraphQL automática, panel de administración, roles/permisos y automatizaciones (Flows).
- **Servicio de aplicación:** Node.js + TypeScript (webhook de WhatsApp + capa de IA + motor de agenda), desplegado en el mismo droplet de DigitalOcean, hablando con Directus vía su SDK/REST.
- **WhatsApp:** YCloud (BSP oficial de Meta)
- **IA:** Claude API (Anthropic) con *tool use* (function calling)
- **Multi-odontólogo:** diseño desde el inicio para N dentistas (no solo 2)

### Reparto de responsabilidades
- **Directus =** fuente de verdad de los datos + panel de administración + auth/roles + automatizaciones simples. Los odontólogos y recepción gestionan servicios, horarios y ven citas **desde el panel de Directus** (esto resuelve gran parte de la Fase 8 sin construir un panel a medida).
- **Servicio Node/TS =** lógica que Directus no hace por sí solo: recibir mensajes de WhatsApp, orquestar a Claude, calcular disponibilidad y aplicar reglas de reserva. Lee/escribe en Directus por API.
- **Regla de integridad crítica** (evitar doble reserva): se implementa como **hook de Directus** (extensión que valida solape en `appointments.items.create`), de modo que la BD queda protegida sin importar qué cliente escriba.

---

## Fase 0 — Decisiones y requisitos (antes de programar)

1. **Reglas de negocio a confirmar con la clínica:**
   - Horario de atención de la clínica y de cada odontólogo (pueden diferir).
   - Días laborables, festivos y vacaciones por odontólogo.
   - Catálogo de servicios con **duración exacta** por servicio (ej. limpieza 30 min, endodoncia 60 min).
   - ¿Un servicio lo hace cualquier odontólogo o hay especialidades? (ej. solo el Dr. X hace ortodoncia).
   - Tiempo de "buffer" entre citas (ej. 5–10 min de limpieza del box).
   - Política de cancelación / reprogramación (¿con cuánta antelación?).
   - ¿Se piden datos del paciente la primera vez? (nombre, cédula/DNI, motivo).
   - Idioma(s) y tono del bot.
   - ¿Cuándo pasar a un humano? (recepción).

2. **Cumplimiento y datos:**
   - Aviso de privacidad / consentimiento de datos de salud (LOPD / ley local).
   - Opt-in explícito para recibir mensajes por WhatsApp (requisito de Meta).

---

## Fase 1 — Alta de cuentas y credenciales

1. **YCloud:**
   - [x] Crear cuenta en YCloud.
   - [x] Registrar/verificar el número de WhatsApp Business (número dedicado de la clínica, no uno personal en uso).
   - [x] Verificación del **WhatsApp Business Account (WABA)** y del **Business Manager** de Meta (YCloud guía este paso; es la parte "oficial" pero simplificada).
   - [x] Obtener **API Key** de YCloud (panel YCloud → API Keys) → completado `YCLOUD_API_KEY` en `.env`.
   - [x] Completar `WHATSAPP_FROM` en `.env` con el número conectado (formato E.164).
   - [x] Configurar el **webhook** entrante en YCloud apuntando a `https://api.egonia.site/webhook/ycloud`, suscrito al evento `whatsapp.inbound_message.received`.
   - [x] Copiar el **secreto del webhook** generado por YCloud → `YCLOUD_WEBHOOK_SECRET` en `.env`.
   - [x] Desplegar el servicio Node en el droplet (Docker, ver README §6) con las variables completas; verificación de firma probada (401 sin firma válida, 200 con firma válida).
   - [ ] Probar con un WhatsApp **real**: enviar un mensaje al número conectado y verificar que `src/server.ts` recibe el evento y responde el eco vía `sendText`.
2. **Anthropic:** crear API key de Claude.
3. **Infra (ya disponible):** servidor DigitalOcean con Directus corriendo.
   - Crear un **token de acceso estático** (o un rol de servicio) en Directus para que el servicio Node/TS opere con permisos acotados.
   - Verificar que Directus tenga habilitado el motor de **extensiones** (para el hook de solape) y opcionalmente **Flows**.
   - Desplegar el servicio Node/TS en el mismo droplet (PM2 o Docker) detrás de Nginx con HTTPS; el webhook de YCloud apuntará a este servicio.
   - Confirmar backups de la base de datos de Directus.

---

## Fase 2 — Modelo de datos (colecciones en Directus)

Se crean como **colecciones de Directus** (desde el panel o vía API), lo que da automáticamente CRUD, API y UI de administración. Colecciones principales:

- `dentists` — id, nombre, activo.
- `services` — id, nombre, duración_min, buffer_min, activo.
- `dentist_services` — relación N:M (Directus M2M) entre dentistas y servicios (permite especialidades).
- `working_hours` — dentist_id (M2O), día_semana, hora_inicio, hora_fin.
- `time_off` — dentist_id (M2O), fecha/rango (festivos, vacaciones, ausencias).
- `patients` — id, teléfono (clave por WhatsApp), nombre, documento, notas.
- `appointments` — id, dentist (M2O), patient (M2O), service (M2O), inicio, fin, estado (pendiente/confirmada/cancelada/completada/no_show), origen.
- `conversations` / `messages` — historial de chat por paciente (contexto para la IA y auditoría).

Ventajas de hacerlo en Directus:
- **Roles y permisos:** crear un rol "Odontólogo" que solo vea/edite su propia agenda, y un rol "Recepción" con acceso ampliado.
- **Tipado en Node/TS:** generar tipos a partir del esquema con el **SDK oficial de Directus** (`@directus/sdk`).
- No se necesita Prisma ni migraciones manuales: el esquema vive en Directus (se puede versionar con *schema snapshots* de Directus para reproducirlo entre entornos).

---

## Fase 3 — Motor de agenda (el corazón del sistema)

Lógica en el servicio Node/TS (funciones puras y testeables), que **lee datos desde Directus** vía `@directus/sdk`:

1. **`getAvailableSlots(serviceId, dentistId?, fromDate, toDate)`**
   - Toma la **duración del servicio** + buffer (desde `services`).
   - Consulta a Directus `working_hours` − `time_off` − `appointments` existentes.
   - Genera huecos válidos (ej. en pasos de 15 min) donde cabe la cita completa.
   - Si no se especifica dentista, devuelve disponibilidad de **todos** los que ofrecen ese servicio ("con quien esté libre antes").
2. **`bookAppointment(...)`** crea la cita en Directus. El control de doble reserva se refuerza en **dos niveles**:
   - En el servicio Node (chequeo previo de solape antes de crear).
   - En **Directus mediante un hook de extensión** (`filter` sobre `appointments.items.create`/`update`) que rechaza la creación si hay solapamiento con el mismo dentista → protege la integridad aunque la cita se cree desde el panel de Directus o desde otro cliente.
3. **`rescheduleAppointment(...)`** y **`cancelAppointment(...)`** respetando la política de antelación.
4. **Reglas:** no citas en el pasado, no fuera de horario, respetar solapes y buffer.

Este módulo escala a N odontólogos sin cambios (solo se agregan filas en Directus).

---

## Fase 4 — Capa de IA (Claude con *tool use*)

Claude interpreta el lenguaje natural del paciente y decide qué herramienta llamar. Se le exponen "tools":

- `list_services()` — lista servicios y duraciones.
- `check_availability(service, preferred_dentist?, date_range)` → slots.
- `book_appointment(service, dentist, datetime, patient_data)`
- `reschedule_appointment(appointment_id, new_datetime)`
- `cancel_appointment(appointment_id)`
- `get_my_appointments(phone)`
- `handoff_to_human(reason)`

Diseño:
- **System prompt** con: rol (recepcionista virtual de la clínica), servicios, políticas, tono, zona horaria, y la instrucción de **siempre confirmar** fecha/hora/servicio/odontólogo antes de reservar.
- La IA **nunca inventa disponibilidad**: solo ofrece slots devueltos por el motor de agenda.
- Manejo de contexto: se le pasa el historial reciente de la conversación (tabla `messages`).
- Modelo sugerido: `claude-sonnet-5` (equilibrio coste/calidad) para el chat; se puede ajustar.

---

## Fase 5 — Integración con WhatsApp (YCloud)

1. **Webhook entrante:** endpoint `POST /webhook/ycloud` que recibe mensajes, valida la firma/secret de YCloud, y encola el procesamiento.
2. **Pipeline por mensaje:**
   - Identificar/crear `patient` por número.
   - Guardar mensaje entrante.
   - Pasar a la capa de IA → ejecutar tools → generar respuesta.
   - Enviar respuesta con la **API de envío de YCloud**.
3. **Ventana de 24 h y plantillas:** fuera de la ventana de sesión de 24 h de WhatsApp, solo se puede iniciar contacto con **plantillas aprobadas** (HSM). Necesarias para:
   - Recordatorios de cita.
   - Confirmaciones proactivas.
   - Se redactan y se envían a aprobar por Meta desde YCloud (tarda de horas a 1–2 días).
4. **Mensajes interactivos:** usar botones/listas de YCloud para elegir servicio, día u hora (mejor UX que texto libre).

---

## Fase 6 — Flujos de conversación

- **Agendar:** saludo → servicio → (odontólogo o "el primero libre") → fecha/franja → mostrar slots → confirmar → reservar → confirmación.
- **Reprogramar / Cancelar:** identificar cita del paciente → confirmar cambio.
- **Consultar mis citas.**
- **Preguntas frecuentes** (dirección, horarios, precios si aplica).
- **Escalar a humano** (recepción) cuando la IA no puede resolver.

---

## Fase 7 — Recordatorios y automatizaciones

Dos opciones (elegir según preferencia):
- **Directus Flows** con disparador programado (schedule/cron): recorre las citas próximas y llama al endpoint de envío. Ventaja: se administra desde el propio panel de Directus.
- **Cron job en el servicio Node** (node-cron / worker) que consulta Directus.

En ambos casos:
  - Envía recordatorio 24 h y/o 2 h antes (plantilla aprobada de WhatsApp).
  - Permite confirmar/cancelar desde el recordatorio.
  - Marca `no_show` tras la hora si no se presentó (opcional).

---

## Fase 8 — Panel / visibilidad para la clínica (mayormente resuelto por Directus)

El **panel de administración de Directus es el panel de la clínica**:
- Rol "Odontólogo": permisos para ver **solo sus propias citas** (filtro por dentista) y gestionar su `working_hours`/`time_off`.
- Rol "Recepción": ver/crear/editar todas las citas y pacientes.
- Vista de calendario: usar el layout de calendario de Directus sobre la colección `appointments`.
- **Opcional:** sincronizar citas a Google Calendar de cada dentista (solo lectura) para verlas en el móvil; Directus sigue siendo la fuente de verdad. Se puede hacer con un Flow que dispare en `appointments.create/update`.

---

## Fase 9 — Pruebas

- **Unitarias** del motor de agenda (solapes, duraciones, buffers, multi-dentista).
- **Integración** del webhook y envío YCloud (con número de prueba).
- **Simulación de conversaciones** con Claude (casos: ambigüedad, cambio de opinión, horarios llenos).
- Pruebas de **concurrencia** (dos personas pidiendo el mismo hueco).

---

## Fase 10 — Despliegue, seguridad y puesta en marcha

- Variables de entorno para todas las llaves (nunca en el repo).
- Validar firma del webhook; rate limiting.
- Cifrado en tránsito y en reposo; mínima retención de datos de salud.
- Logs y monitoreo (errores, latencia de la IA).
- **Piloto** con la clínica (número real, tráfico limitado) antes de anunciarlo a pacientes.

---

## Orden de trabajo sugerido (hitos)

1. [x] Definir colecciones en Directus (Fase 2) + roles + token de servicio.
2. [x] Scaffolding del servicio Node/TS (servidor web + `@directus/sdk` + tipos).
3. [x] Motor de agenda + tests (leyendo de Directus, sin WhatsApp aún).
4. [x] Hook de Directus para bloquear solapes (integridad de doble reserva).
5. [x] Webhook YCloud (eco de mensajes) para validar conectividad.
6. [x] Capa de IA con tools conectada al motor de agenda (`src/ai/`: `tools.ts`, `agent.ts`, `systemPrompt.ts`).
7. [x] Flujos completos (agendar/reprogramar/cancelar/consultar) probados de punta a punta contra Directus y Claude reales, simulando el webhook — pendiente solo la prueba con un WhatsApp físico real, bloqueada por el bloqueo de la WABA en Meta (ver nota en README "Estado actual").
8. [x] Plantillas + recordatorios (cron en Node, `src/scheduler.ts`) — código completo y testeado; pendiente someter las plantillas a revisión de Meta y confirmar el envío real (bloqueado por la revisión de la WABA).
9. [x] Ajuste de roles/vistas en el panel de Directus para dentistas y recepción.
10. [ ] Endurecimiento (seguridad, tests, monitoreo) y piloto — revisión de seguridad manual hecha (sin git no corre `/security-review` automatizado): corregidos y desplegados IDOR en cancelar/reprogramar citas, replay del webhook, CORS de Directus, rate limiting del webhook, y contenedor del bot como usuario no-root. Pendiente: logs/monitoreo de errores y latencia, más casos de prueba (ambigüedad de conversación, horarios llenos), y el piloto real con la clínica.

## Estimación aproximada
MVP funcional (agendar/consultar/cancelar por WhatsApp con IA): ~2–4 semanas de desarrollo enfocado, según disponibilidad y tiempos de aprobación de Meta/YCloud.
