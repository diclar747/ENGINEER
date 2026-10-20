# Revisión del sistema Bio-Pass y nueva portada

Fecha de revisión local: 20 de octubre de 2026. Repositorio: `ENGINEER`, instalado en este workspace con PostgreSQL local.

## Alcance revisado

Se inspeccionaron las 91 rutas HTTP, los 19 modelos de Prisma, las páginas web y los servicios de la API. Se compilaron ambos paquetes, se ejecutaron las 182 pruebas automatizadas y se comprobaron flujos locales por HTTP y navegador. Esta revisión distingue el comportamiento implementado de las integraciones que requieren conexión o credenciales externas.

| Área | Flujo implementado | Evidencia principal | Estado de revisión |
| --- | --- | --- | --- |
| Registro y acceso | Asistente público en `/registro`, bot de WhatsApp, PIN de cuatro dígitos, código OTP y recuperación | `auth.controller.ts`, `otp.service.ts`, `bot-state-machine.ts`, `Register.tsx`, `Login.tsx` | Código y pruebas revisados; acceso web validado en la sesión anterior. Entrega real de OTP por WhatsApp pendiente de conexión. |
| Ficha de emergencia | QR público, datos médicos esenciales, contacto principal, modo consulta con PIN, ubicación opcional y registro de escaneos | `emergency.controller.ts`, `emergency.service.ts`, `EmergencyView.tsx`, `qr-pdf.service.ts` | Flujo de código y rutas revisados. No se ejecutó un escaneo real con un tercero. |
| Bóveda clínica | Perfil, medicamentos, estudios, recetas, carga múltiple y descarga de documentos | `medical.controller.ts`, `storage.service.ts`, `Dashboard.tsx`, `StudiesList.tsx` | API, páginas y construcción verificadas. Cifrado de archivos: ver hallazgos. |
| Lectura de documentos | OCR local con Tesseract; análisis de imágenes mediante OpenAI, Gemini o Niro si se configura | `ocr-ai.service.ts`, `ai-vision.service.ts`, `niro.service.ts` | Código revisado. En este arranque: OCR activo, proveedor de visión IA desactivado. |
| Recordatorios | Medicación por horarios o intervalos, citas personales, calendario, avisos programados | `medication-reminder.service.ts`, `cron.service.ts`, `RemindersCalendar.tsx` | Pruebas y código revisados; el cron arranca localmente. Entrega externa no verificada. |
| Doctores y reservas | Catálogo administrado, especialidades, horarios libres, reservas, cobro condicional y aviso al doctor | `doctor.service.ts`, `appointment.service.ts`, `voice-tools.service.ts`, `AdminPanel.tsx` | Lógica y pruebas revisadas; depende de doctores cargados y de WhatsApp para avisos. |
| Asistente conversacional | Motor de estados compartido por WhatsApp y la web, interpretación de intención y alternativas determinísticas | `bot-state-machine.ts`, `intent-router.ts`, `bot.controller.ts`, `Register.tsx` | Pruebas de intención aprobadas. El canal WhatsApp local figura desconectado. |
| Agente de voz | Sesión Realtime y herramientas para precios, doctores y turnos según el usuario | `voice.controller.ts`, `voice-tools.service.ts`, `VoiceAgent.tsx` | Código y compilación revisados. No se probó una llamada Realtime externa. |
| Pagos y suscripción | Precios administrables por país, órdenes, checkout, Bancard, Pix, confirmación y recordatorios de vencimiento | `payment.controller.ts`, `payment.service.ts`, `bancard.service.ts`, `pix.service.ts`, `cron.service.ts` | Precio público local y pruebas aprobados. Bancard desactivado y Pix en modo manual en este arranque. |
| Auditoría | Escaneos y aperturas con PIN registrados por la API; consulta del titular | `ScanAuditLog`, `audit.controller.ts`, `AuditLogs.tsx` | Se reemplazaron tres registros ficticios por una ruta autenticada. Comprobado: sin token 401; con token 200 y mismo número de filas que PostgreSQL. |
| Portabilidad y QR físico | ZIP protegido por PIN, QR PNG y sticker PDF de 3 × 3 cm | `export.service.ts`, `qr-pdf.service.ts`, `HistoryExport.tsx`, `QrStickerStudio.tsx` | Código y pruebas de exportación/URL firmada revisados. |
| Administración | Titulares, suscripciones, pagos, condiciones, doctores, turnos, prompts, bot y estadísticas | `admin.controller.ts`, `AdminPanel.tsx` | 43 rutas bajo `/admin` protegidas por `requireAdmin`; no se ejercieron acciones de cobro o borrado. |
| Plataforma | PostgreSQL/Prisma, API Express, React/Vite, PWA, archivos locales/firmados, correo y Web Push | `server.ts`, `schema.prisma`, `sw.js`, `signed-url.ts`, `email.service.ts`, `push.service.ts` | API y web en ejecución. 22 migraciones aplicadas y esquema al día. Email en modo registro y Web Push desactivado. |

## Comprobaciones ejecutadas

- PostgreSQL local conectado en `127.0.0.1:5432`; 22 migraciones al día.
- `backend`: compilación TypeScript aprobada; 11 archivos de prueba y 182 pruebas aprobadas.
- `frontend`: compilación TypeScript y Vite aprobadas.
- API local en línea; rutas de información de bot, precios y términos responden. Precio mensual de Paraguay recibido de la API: `Gs. 15.000` durante esta prueba.
- Nueva portada en `/`: imágenes cargadas, navegación móvil, preguntas desplegables y cambio de país/precios comprobados en navegador.
- Auditoría nueva: 401 sin sesión y 200 con sesión; un registro devuelto, igual que en la base del titular usado en la prueba.

## Hallazgos que requieren decisión

1. **Términos desactualizados.** `legal/terms.ts` afirma bloqueo a los cuatro días, multa y borrado automático a los treinta días. `cron.service.ts` ahora pasa a espera a los veinte días, sin multa ni purga automática por impago. El texto legal debe revisarse por el responsable del producto antes de publicarse o prometerse en marketing. La nueva landing describe el flujo vigente de forma general.
2. **Cifrado descrito de forma demasiado amplia.** `storage.service.ts` escribe los archivos recibidos tal como llegan; `medical.controller.ts` almacena los binarios sin cifrado por PIN. El texto extraído usa KMS si existe `KMS_KEY`; esa clave no está configurada en este entorno. El blob clínico del navegador sí usa AES-GCM derivado del PIN. Por eso la nueva landing habla de separación de acceso, PIN y enlaces temporales, sin prometer cifrado total de cada archivo.
3. **Llamada telefónica automática simulada.** `EmergencyService.triggerEmergencyCall()` devuelve un identificador `CA_mock_call_*` y no invoca Twilio. La ficha abre el marcador telefónico del dispositivo, pero no debe anunciarse una llamada automatizada real.
4. **Canales externos no verificados localmente.** El arranque reporta WhatsApp desconectado, Web Push apagado, email en modo registro, Bancard apagado, Pix manual y visión IA apagada. El agente Realtime y cualquier PSP requieren pruebas con cuentas y credenciales de prueba específicas. La landing usa frases condicionales para esos canales.
5. **Listado de métodos de pago.** `/payments/methods` puede listar Bancard aun cuando la integración esté apagada. La landing toma únicamente los importes de esa API y deja la confirmación del medio de pago al checkout.
6. **Registros anteriores de alertas.** Los escaneos guardados antes de esta corrección podían marcar WhatsApp como enviado aun cuando el bot estuviera desconectado. El nuevo registro actualiza esa marca solo cuando el cliente devuelve éxito; esto no demuestra recepción en el teléfono.

## Cambios de esta entrega

- Ruta `/` convertida en landing completa con imágenes originales, diseño adaptable, descripción de funciones, flujo, privacidad, planes con precios vivos, preguntas frecuentes y llamadas a registro e ingreso.
- Carga diferida de las páginas internas para reducir el JavaScript inicial de la portada.
- Historial de auditoría del titular conectado a datos reales mediante `/api/audit-logs` y corrección de la marca de envío de WhatsApp para que solo sea verdadera cuando el cliente informa envío exitoso.

## Límite de esta revisión

La batería automatizada y la prueba local cubren reglas y rutas disponibles. No demuestran entrega real de WhatsApp, correo o push; cobros Bancard/Mercado Pago; ni una conversación de voz Realtime. Esas pruebas requieren entornos externos habilitados y cuentas de prueba controladas.
