# Clínica Dental — Bot de WhatsApp para agenda

Chatbot de WhatsApp (vía **YCloud**, BSP oficial de Meta) con IA (**Claude**) para
gestionar la agenda de una clínica dental con varios odontólogos. Los datos viven
en **Directus** (PostgreSQL, self-hosted). Ver el plan completo en [`PLAN.md`](./PLAN.md).

## Requisitos
- Node.js >= 20
- Un Directus 11.x accesible (self-hosted) con un token de servicio
- (Más adelante) cuenta de YCloud y API key de Anthropic

## Puesta en marcha
```bash
npm install
cp .env.example .env   # completa las variables
```

### 1. Provisionar el esquema en Directus
Crea las colecciones (`dentists`, `services`, `working_hours`, `time_off`,
`patients`, `appointments`, `messages`) automáticamente. Necesita un token con
permisos de administración de esquema:
```bash
DIRECTUS_ADMIN_TOKEN=<token_admin> npm run provision
```
Es idempotente: puedes ejecutarlo varias veces.

### 2. Cargar datos (odontólogos, servicios, horarios)
Edita el bloque `CONFIG` en `scripts/seed-directus.ts` con los datos reales y corre:
```bash
DIRECTUS_ADMIN_TOKEN=<token_admin> npm run seed
```
Idempotente: odontólogos/servicios se actualizan por nombre, los horarios se reemplazan por completo.

### 3. Roles del panel (Odontólogo / Recepción)
Configurados manualmente en Directus siguiendo el modelo de **Access Policies + Roles** (ver historial del proyecto): cada odontólogo ve solo su propia agenda vía filtro `dentist.usuario = $CURRENT_USER`.

### 4. Hook de integridad (anti solapes)
Extensión en `directus-extensions/appointments-overlap-guard/` que rechaza (HTTP 403) cualquier cita creada o editada que se solape con otra activa del mismo odontólogo, respetando el `buffer_min` del servicio. Se aplica sin importar el origen de la escritura (bot, panel, API). Ver esa carpeta para el código; instalación: build con `npm run build` dentro de esa carpeta, copiar `package.json` + `dist/` a la carpeta `extensions` del contenedor Docker de Directus, y reiniciar.

### 5. Desarrollo y pruebas
```bash
npm test          # tests del motor de agenda
npm run typecheck # verificación de tipos
npm run dev       # servidor en modo watch (cuando exista src/server.ts)
```

### 6. Despliegue en producción (droplet)
El servicio corre en Docker en el mismo droplet que Directus (`142.93.191.227`), como contenedor `clinica-dental-bot`, publicado solo en `127.0.0.1:3000` (no expuesto directo a internet). Nginx enruta `https://api.egonia.site/webhook/ycloud` hacia ese contenedor mediante un `location` específico en `/etc/nginx/sites-available/api.egonia.site`, dejando el `location /` existente intacto (sigue yendo a Directus en `127.0.0.1:8055`).

Build y despliegue:
```bash
# en el droplet, dentro de ~/clinica-dental-bot (código + .env de producción)
docker build -t clinica-dental-bot .
docker run -d --name clinica-dental-bot --restart unless-stopped \
  --env-file .env -p 127.0.0.1:3000:3000 clinica-dental-bot
```
Para actualizar tras un cambio de código: volver a copiar el código, `docker build`, luego `docker stop clinica-dental-bot && docker rm clinica-dental-bot` y repetir el `docker run`.

## Estructura
```
src/
  config.ts              # carga y valida variables de entorno (zod)
  directus.ts            # cliente Directus tipado (SDK) + esquema de colecciones
  domain/
    types.ts             # tipos de dominio (Service, Appointment, Slot, ...)
    availability.ts      # motor de agenda: cálculo de huecos, solapes, buffer
    availability.test.ts # tests del motor
  repositories/
    availability.ts      # conecta Directus con el motor de agenda (por odontólogo)
    appointments.ts       # crear/reprogramar/cancelar/listar citas, con doble chequeo de solape
    dentists.ts, services.ts, patients.ts, messages.ts
  ai/
    tools.ts              # tools de Claude (list_services, check_availability, book_appointment, ...)
    agent.ts               # loop de tool-use: llama a Claude, ejecuta tools, hasta respuesta final
    systemPrompt.ts        # rol, políticas (nunca inventar disponibilidad, confirmar antes de reservar)
scripts/
  provision-directus.ts  # crea las colecciones en Directus
  seed-directus.ts       # carga odontólogos, servicios y horarios (config editable)
directus-extensions/
  appointments-overlap-guard/  # hook de Directus: bloquea citas solapadas
clinica/
  # panel web (Vue 3 + TS + Vite), proyecto independiente — ver clinica/README.md
```

## Estado actual
- [x] Scaffolding Node/TS + config + cliente Directus tipado
- [x] Modelo de datos como colecciones de Directus (script de provisión)
- [x] Motor de agenda (duración por servicio, buffer, ausencias, solapes, pasado) + tests
- [x] Datos de prueba cargados (seed): 2 odontólogos, catálogo de servicios, horarios
- [x] Roles Odontólogo / Recepción configurados en Directus
- [x] Hook de Directus para bloquear solapes al escribir (probado end-to-end en producción)
- [x] Webhook de YCloud: recepción de mensajes + eco de respuesta (`src/server.ts`), probado end-to-end contra Directus real (falta cuenta YCloud real para probar el envío)
- [x] Número de WhatsApp Business conectado/verificado en YCloud (WABA activo)
- [x] Servicio Node/TS desplegado en el droplet vía Docker (`clinica-dental-bot`, puerto 3000 solo en localhost), con Nginx enrutando `https://api.egonia.site/webhook/ycloud` hacia el contenedor (mismo dominio que ya sirve Directus, sin tocar su `location /`)
- [x] Cuenta YCloud operativa: API Key, webhook secret y número (`WHATSAPP_FROM`) configurados en `.env`; webhook entrante suscrito a `whatsapp.inbound_message.received`; verificación de firma HMAC probada de extremo a extremo (401 sin firma, 200 con firma válida)
- [x] Capa de IA (Claude + tools) y flujos de agendar / reprogramar / cancelar / consultar citas, probados de punta a punta contra Directus y Claude reales (crear cita, rechazo de doble-booking con alternativas, listar servicios, derivar a humano)
- [x] Tests automatizados de la capa de IA y el webhook (40 tests en total, `npm test`): `repositories/appointments.test.ts` (reserva, reprogramación, rechazo de solapes incluyendo la condición de carrera con el hook de Directus), `ai/tools.test.ts` (las 8 tools con dependencias mockeadas), `server.test.ts` (integración HTTP del webhook — firma válida/inválida — y el pipeline completo de `processInboundEvent`)
- [ ] Prueba con un WhatsApp real: bloqueada por ahora — la WABA fue **bloqueada por Meta** (`errorCode 131031`, `wabaId 3135717036624271`); hay que resolverlo en Meta Business Manager o con soporte de YCloud antes de poder confirmar el envío real. Mientras tanto todo el flujo se probó simulando el webhook contra Directus/Claude reales.
- [x] Panel web (`clinica/`, Vue 3 + TS + Vite + Tailwind): login (sesión de Directus, sin registro), dashboard de estadísticas (citas confirmadas/pendientes/canceladas hoy, canceladas y no-shows de la semana, desglose por odontólogo, próximas citas), menú de citas (listar/filtrar/crear manualmente/editar/cancelar) y agenda por odontólogo (grilla de horario con ausencias y citas, click para crear/editar). Desplegado en `https://panel.egonia.site`. Ver [`clinica/README.md`](./clinica/README.md).
- [ ] Plantillas y recordatorios: código completo y testeado — motor puro (`domain/reminders.ts`, ventanas de 24h/2h con flags idempotentes en `appointments`), repositorio (`repositories/reminders.ts`, resuelve paciente/servicio/dentista y envía vía `sendTemplate`) y scheduler (`src/scheduler.ts`, cada `REMINDER_CHECK_INTERVAL_MINUTES`, apagado por defecto vía `REMINDERS_ENABLED=false`). Pendiente: someter las 2 plantillas (`scripts/create-whatsapp-templates.ts`) a revisión real de Meta y confirmar el envío real — ambos bloqueados/pospuestos mientras la WABA siga en revisión (ver nota arriba).
- [x] Revisión de seguridad manual y correcciones desplegadas: IDOR en `cancel_appointment`/`reschedule_appointment` (no verificaban dueño de la cita), replay del webhook de YCloud (falta de ventana de tolerancia en el timestamp de la firma), CORS de Directus demasiado permisivo (`CORS_ORIGIN` acotado a los orígenes reales del panel), rate limiting en `/webhook/ycloud`, y contenedor del bot corriendo como usuario no-root. Ver detalle en `CLAUDE.md`.
- [ ] Lista de espera: código completo y testeado — nueva colección `waitlist` (`scripts/provision-directus.ts`), motor puro de coincidencia día/hora (`domain/waitlist.ts`), repositorio con el job de oferta automática (`repositories/waitlist.ts`, reutiliza `getAvailableSlots`), 5 tools de IA (`join_waitlist`/`list_my_waitlist_entries`/`leave_waitlist`/`confirm_waitlist_offer`/`decline_waitlist_offer`), endpoint interno `/internal/waitlist/run` + nueva extensión de Directus `waitlist-notify-hook` (dispara el barrido al cambiar una cita) + barrido periódico de respaldo (`WAITLIST_ENABLED=false` por defecto), y pantalla nueva en el panel (`clinica/src/views/WaitlistView.vue`). Pendiente antes de usarse en producción: correr `npm run provision` contra Directus real (crea la colección `waitlist`), otorgar permisos de esa colección a las políticas `Bot WhatsApp`/`Receptionist`, someter la plantilla `lista_espera_cupo_disponible` a revisión de Meta, desplegar el bot y la nueva extensión al droplet, y activar `WAITLIST_ENABLED=true`.
