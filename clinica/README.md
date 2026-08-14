# Panel Clínica Dental

SPA en Vue 3 + TypeScript + Vite para recepción/odontólogos: login, dashboard de estadísticas, gestión manual de citas (listar/crear/editar, con horarios disponibles por odontólogo) y mantenimiento del horario laboral.

No tiene backend propio: es un cliente estático que habla directamente con la API de Directus (la misma instancia que usa el bot de WhatsApp), autenticado con el login nativo de Directus (email/contraseña, modo `session` por cookie — sin registro). Los permisos de cada usuario (qué puede ver/editar) los define enteramente Directus según su rol/policy (`Doctor` ve solo su propia agenda/pacientes propios/horario propio, `Receptionist` ve y gestiona todo) — el panel no implementa autorización propia.

**Mantenimiento de horario laboral (`WorkingHoursView.vue`, ruta `/horario`, reemplazó a la antigua vista "Agenda"):** agregar/editar/eliminar bloques de `working_hours` (día de la semana + hora inicio/fin), agrupados por día. Un odontólogo edita directo el suyo (sin selector, `catalog.dentists` ya lo restringe a sí mismo); un recepcionista elige a quién gestionar con un `<select>`.

Dos reglas al guardar (ambas replicadas en la extensión `working-hours-guard`, ver CLAUDE.md):
- **No se admiten bloques superpuestos** del mismo médico el mismo día. Contiguos sí (08–11 + 11–13). El panel solo ve la clínica activa; si el choque es con otra sede lo rechaza el hook con un 403 que `directusErrors.ts` traduce.
- **Recortar, mover o borrar un bloque cancela las citas que se quedan sin horario**, previa confirmación con el detalle de a quién afecta (mismo flujo que `TimeOffFormModal`, con la lógica común en `lib/cancelCascade.ts`). Solo se cancela lo que pisa el tramo que desaparece: lo que ya estaba fuera de horario sigue igual, y lo que otro bloque del mismo día siga cubriendo no se toca. Quedan con `cancelada_por_ausencia: true` y motivo "Cambio de horario del médico", así que aparecen en la pestaña "Cancelaciones" de Mensajes para avisar al paciente. El cálculo puro está en `lib/workingHours.ts` con tests. Requirió agregar permisos `create`/`delete` de `working_hours` a la policy `Dentist` en Directus (antes solo tenía `read`/`update`, heredado de cuando la única acción posible desde el panel era editar un bloque existente vía Agenda).
**Limitación conocida de Directus:** el filtro `permissions` de un rol/policy (usado en read/update/delete) sí soporta rutas relacionales como `dentist.usuario._eq($CURRENT_USER)` porque compara contra la fila ya existente en la base de datos. El campo `validation` de un permiso `create`, en cambio, se evalúa contra el payload recién enviado (la fila todavía no existe), así que **no puede resolver relaciones** — un primer intento de restringir el `create` de `working_hours` con `validation: {dentist: {usuario: {_eq: "$CURRENT_USER"}}}` falló con "Value is required" para el campo `dentist`. El permiso `create` de la policy `Dentist` quedó sin esa restricción (cualquier fila con cualquier `dentist` id es válida a nivel de Directus); la UI ya solo ofrece el propio id como opción, así que en el uso normal esto no es explotable — pero técnicamente un odontólogo que arme una petición manual a la API podría crear un bloque de horario a nombre de otro odontólogo. Cerrar esto del todo requeriría un Directus Flow o extender el hook `appointments-overlap-guard` para validar la relación en el servidor; quedó pendiente como mejora de endurecimiento, no bloqueante para esta función.

**Búsqueda de paciente al crear cita (`AppointmentFormModal.vue`):** un solo campo busca por `nombre` O `telefono` a la vez (`_or`), para no perder de vista a los pacientes que el bot de WhatsApp autocrea solo con teléfono (sin nombre); un mismo número puede tener varias personas, y el nombre es lo que las distingue. Excluye a los dados de baja (`activo: {_neq: false}`). Si no encuentra nada, muestra nombre + teléfono (obligatorios) para crear el paciente nuevo. Si encuentra uno existente sin nombre, permite completarlo/editarlo ahí mismo (ver nota de abajo). Si hay un solo resultado, se autoselecciona (sin exigir clic); con 2+ resultados, hay que elegir de la lista.

**Fecha y hora en `AppointmentFormModal.vue`:**
- Hora: dos `<select>` (hora 00-23 + minuto solo 00/30) en vez de un `input[type=time]` nativo — un `step` nativo no evita que el navegador siga ofreciendo los 60 minutos en su selector.
- Fecha: calendario propio (`components/DatePicker.vue`) en vez de `input[type=date]` nativo — deshabilita visualmente los días anteriores a hoy y los días de la semana sin horario laboral para el odontólogo elegido (ej. domingos, si nadie atiende ese día). Se recalcula al cambiar de odontólogo (`watch(dentistId)` trae sus `working_hours`); si la fecha ya elegida deja de ser válida al cambiar de odontólogo, `dateMatchesDentistSchedule` bloquea el guardado con un aviso.

**Citas: dos pantallas, no dos tarjetas.** Consultar la agenda y agendar viven en rutas separadas, agrupadas bajo el ítem "Citas" del menú (`AppNav.vue`, el único componente de navegación: lo comparten el sidebar de escritorio y el drawer móvil):
- **`/citas` (`AppointmentsView.vue`) — "Agendadas":** la tabla de citas del día, con sus filtros de fecha, odontólogo y estado, edición, cancelación rápida y el enlace de WhatsApp para confirmar.
- **`/citas/agendar` (`BookAppointmentView.vue`) — "Agendar":** los huecos de 30 min de cada odontólogo para el día elegido, calculados con `src/lib/schedule.ts` (`computeDaySlots`: horario laboral + `time_off` + citas activas), con sus propios filtros de fecha, especialidad y servicio. Click en un hueco libre abre el modal de nueva cita precargado con ese odontólogo/hora/servicio. Solo recepción/admin: la policy `Doctor` no tiene `appointments.create`, así que un odontólogo solo llegaba a un 403 al guardar (la ruta lleva `meta.blockDoctor`).

Antes eran dos tarjetas de la misma pantalla y **compartían el filtro de fecha**, pero cada una tenía además filtros que la otra ignoraba (odontólogo/estado no afectan la disponibilidad; especialidad/servicio no afectan la tabla). Las pruebas con usuarios mostraron que esa mezcla confundía. La separación es visual: el cálculo de huecos, las consultas y el modal no cambiaron, solo que cada pantalla tiene ahora su propia fecha y su propio refresco en segundo plano (polling de 15 s).

**Importante:** el store `catalog` (odontólogos/servicios) se cachea una sola vez por pestaña — `auth.ts` llama a `catalog.reset()` en `login()` y `logout()` para que cambiar de cuenta en la misma pestaña siempre traiga una lista fresca acorde a los permisos del nuevo usuario, en vez de arrastrar la del usuario anterior (bug real encontrado: una recepcionista que iniciaba sesión justo después de un odontólogo, sin recargar, veía solo la lista reducida de ese odontólogo).

### Diseño
Paleta e identidad visual extraídas de un flyer de referencia de la clínica (azul marino/blanco, sobrio y profesional). Tokens definidos en `src/style.css` vía `@theme` de Tailwind v4 (sin `tailwind.config.js`, todo en CSS):
- Color de marca: escala `brand-50`…`brand-900` (azul marino, `brand-700` como color primario de botones/header/footer).
- Tipografía: `Poppins` (600/700/800, utilidad `font-display`) para títulos y el logotipo; `Inter` para el resto de la UI — ambas cargadas por Google Fonts en `index.html`.
- Colores de estado (pendiente/confirmada/cancelada/etc.) se mantienen en ámbar/esmeralda/rojo/naranja, deliberadamente distintos del azul de marca para no confundir "estado" con "identidad visual".
- Responsive: `AppLayout.vue` colapsa la navegación a un menú hamburguesa por debajo de `md`; tablas (`AppointmentsView.vue`) con scroll horizontal (`overflow-x-auto`); el modal de citas (`AppointmentFormModal.vue`) limita su alto y hace scroll interno en pantallas pequeñas. Verificado en el navegador en anchos de móvil/tablet/desktop.

## Desarrollo
```bash
npm install
cp .env.example .env   # completa VITE_DIRECTUS_URL si no es https://api.egonia.site
npm run dev            # http://localhost:5173
npm run typecheck
npm test               # vitest: matemática pura de reportes + generación de PDF/Excel
npm run build           # genera dist/
```

## Estructura
```
src/
  lib/
    directus.ts       # cliente Directus (auth por cookie de sesión) + tipos del schema
    dateRanges.ts      # helpers de fecha/hora en la zona horaria de la clínica
    stats.ts           # queries de estadísticas del dashboard
    queryHelpers.ts     # workaround del hueco de tipado del SDK para filtros de fecha (_gte/_lte, _lt/_gt)
    directusErrors.ts   # mensajes legibles (distingue solape vs permiso denegado)
    schedule.ts          # computeDaySlots: horario laboral + time_off + citas activas -> huecos libres
    recall.ts             # computeRecallItems: a quién le toca volver según services.recall_meses
    messageTemplates.ts    # textos de confirmación/seguimiento/cancelación + link wa.me
    costaRica.ts            # provincias/cantones/distritos para la dirección del paciente
    reports/                 # sección de Reportes (ver sección abajo)
      types.ts                # ReportDefinition/ReportSection: los contratos
      registry.ts              # catálogo de reportes — ÚNICO archivo a tocar para agregar uno
      context.ts                # diccionario de nombres (médicos/servicios/especialidades, incluidos los inactivos)
      shared.ts                  # consultas comunes (fetchAppointments, aggregate + groupBy…)
      filters.ts                  # presets de fecha + rol efectivo
      format.ts                    # formateo de celdas para pantalla y PDF (el Excel va crudo)
      occupancy.ts / patientMix.ts  # matemática pura, con tests
      definitions/                   # un archivo por reporte
    export/
      toPdf.ts / toExcel.ts   # genéricos: reciben un ReportResult, no saben qué reporte es
      download.ts              # nombre de archivo + descarga del Blob
  composables/
    useConfirm.ts          # diálogo de confirmación global
    useCopyToClipboard.ts   # copiar con feedback en el propio botón (no hay toasts)
  stores/
    auth.ts       # login/logout/sesión (Pinia)
    catalog.ts     # odontólogos/servicios activos, cacheados por sesión (reset() se llama en login/logout — ver nota abajo)
  router/index.ts  # rutas + guard de autenticación
  views/
    LoginView.vue
    DashboardView.vue
    AppointmentsView.vue    # /citas: listar/filtrar/editar/cancelar las citas del día
    BookAppointmentView.vue  # /citas/agendar: huecos libres por odontólogo (solo recepción/admin)
    WorkingHoursView.vue     # mantenimiento del horario laboral (agregar/editar/eliminar bloques)
    MessagesView.vue          # mensajes que la recepción envía a mano (ver sección abajo)
    PatientsView.vue           # mantenimiento de la ficha del paciente (ver sección abajo)
    ReportsIndexView.vue        # catálogo de reportes
    ReportView.vue               # renderizador genérico: sirve a TODOS los reportes
  components/
    AppLayout.vue
    AppNav.vue                    # menú único (sidebar + drawer móvil), con el submenú de Citas
    StatCard.vue
    reports/ReportFilterBar.vue  # controles según lo que declare el reporte + reglas de rol
    ui/DataTable.vue              # tabla dirigida por columns+rows
    ui/BarChart.vue, LineChart.vue, DonutChart.vue   # SVG propio, sin librerías
    DatePicker.vue              # calendario propio (bloquea pasado y días sin horario)
    AppointmentFormModal.vue   # formulario compartido crear/editar
    PatientFormModal.vue        # ficha del paciente (crear/editar)
```

## Clínicas y médicos que trabajan en varias

El panel siempre opera sobre **una clínica activa** (`stores/clinica.ts`, persistida en `sessionStorage`). Tras el login, si el usuario tiene una sola clínica se autoselecciona y no ve nada distinto; si tiene varias, el guard del router lo manda a `/seleccionar-clinica`, y después puede cambiarla desde el switcher del sidebar sin cerrar sesión (`SelectClinicView.vue` llama a `catalog.reset()`, que es lo que recarga el catálogo con los datos de la nueva clínica). Directus ya devuelve solo las clínicas propias, así que la lista no la filtra el panel.

**Un médico puede trabajar en varias clínicas.** Su identidad es una sola fila `doctors`; las sedes donde atiende viven en la tabla puente `clinics_doctors`, junto con lo que depende de la sede: su `specialty` (las especialidades son por clínica) y un `activo` propio, para darlo de baja en una sin tocar las otras. Un médico multi-clínica ve el mismo selector que una recepcionista multi-clínica, sin nada especial en el login.

- `lib/clinicDoctors.ts` (`loadClinicDoctors`) aplana identidad + vínculo en un `ClinicDoctor` (`{id, nombre, activo, usuario, specialty, linkId}`); lo usan `stores/catalog.ts` (solo activos, clínica actual) y `ClinicManageView.vue` (todos, porque ahí se dan de alta y de baja).
- `auth.ownDoctorId` es la identidad global del médico, no depende de la clínica activa. `WorkingHoursView`/`TimeOffView` lo usan para resolver "mi horario" / "mis ausencias" en vez de tomar el primero del catálogo.
- **Horario y ausencias son por clínica** (`working_hours.clinic`, `time_off.clinic`): el mismo médico puede atender lunes-miércoles en una sede y jueves-viernes en otra, y una ausencia bloquea solo la sede donde se registró.
- **Las citas, en cambio, se miran cross-clínica**: nadie puede estar en dos sedes a la vez. Por eso `BookAppointmentView`/`AppointmentFormModal` calculan los huecos sin filtrar las citas por clínica. Contrapartida conocida: los permisos solo dejan leer las citas de la clínica propia, así que el panel puede ofrecer un hueco que el hook `appointments-overlap-guard` luego rechaza con 403 "se solapa" — es la única salida que no expone datos de otro tenant, y por eso el mensaje del error no dice en qué clínica está la cita que estorba.
- En `/admin/clinicas/:id`, la pestaña Médicos tiene dos botones: **"+ Agregar médico"** (persona nueva) y **"Vincular existente"** (`LinkDoctorModal.vue`), que reutiliza una ficha ya creada en otra clínica y solo agrega el vínculo. Usar el primero para alguien que ya existe crearía una segunda identidad, y entonces nada impediría agendarlo a la misma hora en las dos sedes.
- Al editar, el checkbox "Activo" afecta al vínculo de esa clínica. La cuenta de Directus solo se suspende si el médico quedó inactivo en **todas** sus clínicas.

## Pacientes
`/pacientes` (`PatientsView.vue` + `PatientFormModal.vue`), para **recepción y administrador**: el enlace se filtra en `AppLayout.vue` y la ruta lleva `meta.blockDoctor` — es UX, el borde real es que la policy `Doctor` solo puede *leer* los pacientes con los que tiene una cita y no puede crearlos ni editarlos.

Listado con buscador (nombre, teléfono, identificación o correo, con debounce porque consulta a Directus) y filtro activos/dados de baja/todos, acotado siempre a la clínica activa. Sin paginación: tope de 200 filas y un aviso al pie para refinar la búsqueda.

La ficha agrega a `patients` los campos `identificacion`, `correo`, `provincia`/`canton`/`distrito`, `direccion` (señas exactas) y `activo` — los crea `scripts/provision-patient-fields.ts` (`npm run provision:patients`), que además hace backfill de `activo = true` en las filas existentes, porque el `default_value` de una columna nueva solo aplica a filas nuevas. Por eso todo el código filtra con `activo: {_neq: false}` y no `{_eq: true}`.

Provincia/cantón/distrito son tres `<select>` encadenados alimentados por `src/lib/costaRica.ts` (División Territorial Administrativa: 7 provincias, 84 cantones, ~490 distritos, incluidos Río Cuarto, Monteverde y Puerto Jiménez). Se guardan por **nombre**, no por código, y los selects conservan siempre el valor ya guardado aunque no figure en el catálogo (`withCurrent`), para que una ficha vieja no se vacíe sola al abrirla.

**Nunca se borra un paciente, se da de baja.** `appointments`, `messages` y `waitlist` lo referencian con `ON DELETE CASCADE`: borrarlo se llevaría todo su historial. La baja pone `activo: false`, es reversible, y lo saca del listado y de los buscadores de citas/lista de espera (y del bot: `src/repositories/patients.ts` ignora a los inactivos, así que si esa persona vuelve a escribir por WhatsApp se le crea una ficha nueva en vez de resucitar la vieja).

**Solo el administrador puede dar de baja**, y eso sí es seguridad, no UI: `scripts/provision-clinic-permissions.ts` le da a `Receptionist` un `patients.update` con **lista explícita de campos** (`PATIENT_EDITABLE_FIELDS`) que deja fuera `activo`, y le revoca `patients.delete`. Es la única excepción del proyecto a la invariante `fields: ["*"]` en colecciones de contenido (ver `CLAUDE.md`). **Todo campo nuevo de `patients` hay que agregarlo a esa lista** o recepción no podrá editarlo.

La identificación es opcional y **no tiene índice único en la base**: el bot crea pacientes solo con teléfono, así que el campo se repetiría en vacío. La unicidad por clínica la valida el modal antes de guardar.

## Contraseñas

Tres flujos, todos apoyados en el login nativo de Directus:

| Ruta | Quién | Qué hace |
|---|---|---|
| `/recuperar-clave` | pública | Pide el correo y dispara `/auth/password/request` de Directus. |
| `/restablecer?token=…` | pública | Destino del enlace del correo; consume el token con `/auth/password/reset`. |
| `/cambiar-clave` | sesión, sin layout | Cambio **obligatorio** del primer ingreso. El router manda acá a todo usuario con `must_change_password` y no lo deja salir. |
| `/perfil` | sesión | Cambio voluntario + nombre/apellido. Se llega desde el bloque de usuario del sidebar. |

Además, el admin tiene un botón **"Restablecer contraseña"** en las pestañas de Médicos y Recepción de una clínica: genera una temporal, la muestra una sola vez para copiar y marca la cuenta para cambio obligatorio. Es el respaldo del flujo por correo — sirve aunque el SMTP falle o la persona no tenga acceso a su buzón.

**El cambio voluntario pide la contraseña actual, y esa verificación NO usa la sesión abierta.** `src/lib/reauth.ts` crea un cliente Directus efímero por llamada con `authentication("json", { autoRefresh: false, credentials: "omit" })`. El `credentials: "omit"` es lo importante: el navegador ni manda la cookie vigente ni guardaría una que llegara, así que un intento fallido no puede tumbar la sesión del panel. Reusar el cliente singleton parecía funcionar (hoy el SDK hace `resetStorage()` *después* del request, y un 401 no trae `Set-Cookie`), pero esa garantía es incidental y se rompería en un bump de versión sin que nada lo note.

**El forzado del primer ingreso** se apoya en el campo custom `directus_users.must_change_password`, que crea `scripts/provision-password-management.ts`. El usuario **no tiene permiso para escribirlo** — si lo tuviera, podría apagarlo por API y saltarse el cambio. Quien lo apaga es la extensión `force-password-change-hook`, que reacciona a `users.update` cuando el payload trae `password`. Esa extensión es **prerequisito duro**: sin ella desplegada, quien reciba la bandera queda encerrado en `/cambiar-clave` (salvo un admin, que sí puede escribir el campo y tiene un botón de escape en esa pantalla).

El hook ignora a propósito los payloads que ya traen `must_change_password` explícito: es lo que permite al reset del admin escribir `{password, must_change_password: true}` en un solo PATCH sin que el hook se lo revierta acto seguido.

**Si Directus todavía no tiene el campo**, `loadUser()` reintenta el `readMe` sin él: se pierde el forzado, no el acceso. Sin ese fallback, desplegar el panel antes de correr el script dejaría a todos fuera.

**Las contraseñas generadas se muestran una sola vez.** El wizard de alta junta las credenciales de todas las cuentas que creó y las lista al final con "Copiar todas"; los modales de alta de médico/recepcionista se quedan en una pantalla de credencial en vez de cerrarse. No se guardan en claro en ningún lado: si se pierden, hay que restablecerlas.

Las reglas de contraseña viven en `src/lib/passwordPolicy.ts` y deben ser **espejo** de la env var `PASSWORD_POLICY` de Directus (ese es el borde real: se aplica también en `/auth/password/reset`, donde el SPA se puede saltar con un curl).

Config necesaria fuera del panel: `EMAIL_*` y `PASSWORD_RESET_URL_ALLOW_LIST` en el docker-compose de Directus, y `VITE_PASSWORD_RESET_URL` acá. Las dos URLs tienen que coincidir **literalmente** — una barra final de más y Directus devuelve 400.

## Ausencias: cancelación en cascada
Al guardar una ausencia (`/ausencias`, `TimeOffFormModal.vue`), el panel busca primero las citas activas y **futuras** del médico que caigan dentro del rango — `pendiente`/`confirmada`, nunca `completada` ni citas ya pasadas — y, si hay alguna, exige confirmación mostrando a quién afecta. Si se acepta: se guarda la ausencia y después se cancelan esas citas con `cancelada_por_ausencia: true`. Ese orden importa: al revés, un fallo al guardar la ausencia dejaría citas canceladas sin nada que lo explique. Si se rechaza el diálogo, no se guarda nada.

Lo mismo lo hace en el servidor el hook `time-off-cascade-hook` de Directus, para las ausencias que no pasan por el panel (admin de Directus, API). Las dos capas son idempotentes: la que llegue segunda no encuentra nada que cancelar.

Ambas escriben además `cancelado_en`, `cancelado_por: "clinica"` y `motivo_cancelacion: "Ausencia del médico"` — ver "Trazabilidad de la cancelación" abajo.

## Trazabilidad de la cancelación
Tres campos en `appointments` (`scripts/provision-cancellation-fields.ts`) alimentan el reporte de Cancelaciones: `cancelado_en`, `cancelado_por` (`paciente|recepcion|medico|clinica|admin`) y `motivo_cancelacion`.

Hay cuatro caminos para cancelar una cita (panel, bot de WhatsApp, cascada por ausencia, admin de Directus), y el reporte necesita que los cuatro dejen rastro. La red de seguridad es el hook `appointment-cancel-stamp-hook`: un `filter` sobre `appointments.update` que, cuando el estado pasa a `cancelada` **y la cita no estaba ya cancelada**, completa `cancelado_en` y deriva `cancelado_por` de la accountability de la petición. Va en el mismo UPDATE (por eso `filter` y no `action`) y lo explícito del escritor siempre gana.

Los escritores del panel y del bot mandan igualmente los tres campos, redundantes a propósito: no dependen de que la extensión esté desplegada, mismo criterio que la cascada de ausencias.

La comprobación de "no estaba ya cancelada" no es un detalle: sin ella, cualquier guardado posterior de una cita cancelada (escribir el motivo más tarde, marcar `cancelacion_mensaje_enviado`) reenviaría `estado: "cancelada"` y pisaría la fecha original, desmoronando en silencio la anticipación del reporte.

Las citas canceladas **antes** de este cambio quedan en `null` y el reporte las muestra como "sin dato". No se backfillean: no existe ese dato en ningún lado, y una anticipación inventada es peor que un hueco visible.

Los pacientes afectados **no se avisan solos** — aparecen en la pestaña *Cancelaciones* de Mensajes.

## Reportes
`/reportes` (catálogo) y `/reportes/:reportId` (un renderizador para todos). Visible para **los tres roles**, sin guard de bloqueo: quien recorta es Directus, no la UI. La policy `Doctor` filtra `appointments` por `doctor.usuario`, así que un médico ve los mismos ocho reportes calculados **solo sobre sus propias citas**; recepción y administrador ven la clínica entera y pueden agrupar por especialidad, por médico o por ambos.

Ocho reportes hoy: ocupación de agenda, cancelaciones, no presentados, productividad médica, servicios más solicitados, especialidades más demandadas, pacientes nuevos vs recurrentes y residencia de pacientes.

**Agregar un reporte nuevo = un archivo en `src/lib/reports/definitions/` + una línea en `registry.ts`.** Nada más: ni ruta, ni vista, ni código de exportación. Lo permite el contrato de `types.ts`: toda sección lleva `columns` + `rows` **aunque se dibuje como gráfico**, así que el PDF, el Excel y la tabla salen de la misma estructura y los exportadores están escritos una sola vez.

Detalles que conviene saber antes de tocar esto:
- **La especialidad de una cita es la de su SERVICIO**, no la del médico. El servicio es lo que pidió el paciente y, a diferencia del médico (cuya especialidad vive en `clinics_doctors` y depende de la sede), no cambia según dónde se atienda. Única excepción: ocupación, donde las horas de agenda salen de `working_hours`, que no tiene servicio.
- **Toda consulta filtra por `clinic` en el código.** La policy `Doctor` deliberadamente no acota `appointments` por clínica (el guard de solapes tiene que ser cross-sede), así que sin ese filtro un médico multi-sede vería los totales mezclados sin enterarse.
- **La ocupación recorta las citas contra el horario disponible.** Una cita fuera del horario declarado no empuja el porcentaje por encima de 100%: se cuenta aparte y se avisa en una nota. La matemática está en `occupancy.ts`, pura y con tests.
- **«Paciente nuevo» se deriva de las citas**, no de un campo de alta (que no existe): es nuevo en el mes en que cae su primera cita de toda la historia. Además de evitar un backfill imposible, es la definición que le sirve a la clínica.
- **Sin ingresos.** El esquema no tiene ningún campo de precio; cuando exista facturación hará falta `services.precio` **y** un monto congelado en la cita, o subir una tarifa reescribiría hacia atrás los meses ya cerrados.
- **El Excel lleva los valores crudos** (0.91 con formato `0%`, no la cadena "91%") y una hoja *Filtros* con clínica, período y filtros aplicados. El PDF sí va formateado, en apaisado, y **v1 no incrusta los gráficos** — el punto de extensión está anotado al final de `toPdf.ts`.
- `jspdf` y `exceljs` se cargan con `import()` dinámico: solo se descargan al pulsar Exportar.

## Mensajes (confirmación manual, seguimiento y cancelaciones)
`/mensajes`, visible **solo para el rol Receptionist** (enlace filtrado en `AppLayout.vue` y guard `meta.receptionistOnly` en el router — es UX, no seguridad: la policy `Doctor` no tiene permisos sobre `messages`).

Existe porque la cuenta de WhatsApp Business está bloqueada por Meta: el bot no puede iniciar conversaciones, así que la recepción confirma las citas a mano. La pantalla arma la lista de trabajo, redacta el texto y lleva la cuenta de qué ya se envió. **El envío ocurre fuera del sistema** (llamada, SMS, o el WhatsApp personal vía el link `wa.me`, que no usa la API de Meta y por eso funciona con la cuenta bloqueada).

Tres pestañas:
- **Confirmaciones** — citas en estado `pendiente` de la fecha elegida (por defecto, mañana).
- **Seguimiento** — pacientes a los que se les está cumpliendo el plazo desde su última cita completada de un servicio con periodicidad.
- **Cancelaciones** — citas que se cancelaron solas al registrar una ausencia del médico (`cancelada_por_ausencia`), de los últimos `CANCELLATION_LOOKBACK_DAYS` (7) días en adelante. No incluye las que la recepción canceló de común acuerdo con el paciente: esas ya están habladas.

**El enlace de agendar del mensaje de cancelación.** El texto cierra con una línea `Agende su cita aquí: <link>`, sola y sin puntuación detrás: WhatsApp no admite hipervínculos con texto propio (solo negrita/cursiva/tachado/mono, las URLs se autoenlazan tal cual) y un punto final quedaría dentro del enlace. El link sale de `clinics.booking_short_url`, un link corto de Short.io que genera **una sola vez por clínica** `scripts/shorten-booking-links.ts` (la API key de Short.io permite reescribir el destino de links ya enviados a pacientes, así que no puede vivir en el bundle público del panel). Si el campo está vacío, `bookingLink()` cae al link largo de siempre — no hace falta tener Short.io configurado para que la pantalla funcione. El campo se ve, de solo lectura, en `/admin/clinicas/:id`.

Al pulsar *Enviado* se crea una fila en `messages` (`direccion: "out"`) con el texto exacto y luego se marca el flag en la cita. Ese orden es deliberado: si el registro falla, el flag no se pone y el ítem sigue en la lista en vez de desaparecer sin dejar rastro. La casilla *Ver también los ya enviados* permite deshacer un clic accidental.

**Campos de Directus que usa** (creados por `scripts/provision-directus.ts`):

| Campo | Para qué |
|---|---|
| `services.recall_meses` | Periodicidad del servicio en meses (6 = limpieza semestral). Vacío = no genera seguimiento. **Se edita solo desde el admin de Directus**, el panel no tiene pantalla de servicios. |
| `appointments.confirmacion_manual_enviada` | Ya se envió el mensaje de confirmación de esa cita. |
| `appointments.recall_mensaje_enviado` | Ya se envió el seguimiento derivado de esa cita completada. |
| `appointments.cancelada_por_ausencia` | La cita se canceló por una ausencia del médico (lo marcan el panel y el hook `time-off-cascade-hook`). |
| `appointments.cancelacion_mensaje_enviado` | Ya se avisó al paciente de esa cancelación. |
| `clinics.booking_short_url` | Link corto de Short.io al formulario público de agendar (`scripts/shorten-booking-links.ts`). Vacío = se usa el link largo con el uuid. |

El flag de seguimiento vive en la **cita completada de origen**, no en el paciente: así el ciclo se re-arma solo cuando el paciente vuelve y esa nueva cita se marca `completada`.

Las ventanas de tiempo son constantes en `src/lib/recall.ts`: `RECALL_ANTICIPATION_DAYS` (14, cuántos días antes aparece) y `RECALL_MAX_OVERDUE_MONTHS` (12, cuándo se deja de mostrar). Un seguimiento no aparece si el paciente ya tiene una cita futura de ese mismo servicio.

Requiere el permiso `create` sobre `messages` en la policy `Receptionist` (lo aplica `scripts/provision-clinic-permissions.ts`).

> Nota para cuando Meta desbloquee la cuenta: la lista de confirmaciones solo mira citas `pendiente`. Si el bot vuelve a confirmarlas por su cuenta, la lista se irá vaciando sola. Es el comportamiento esperado, no un bug.

## Despliegue
Build estático servido directo por Nginx (sin Docker, a diferencia del bot) en `https://panel.egonia.site`, en el mismo droplet que Directus y el bot.

```bash
npm run build
rsync -az dist/ root@142.93.191.227:/var/www/clinica/
```

Nginx (`/etc/nginx/sites-available/panel.egonia.site`) sirve `/var/www/clinica` con `try_files $uri $uri/ /index.html` (routing de SPA) y SSL vía Certbot (`certbot --nginx -d panel.egonia.site`).
