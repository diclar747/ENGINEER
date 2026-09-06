# Integración Bancard — Reemplazo del portal `winsap.com.py`

> Sacar el portal externo `winsap.com.py` (donde corre el PHP de `cardnet/`) y
> que el backend Node hable con Bancard directo: URLs de webhook a registrar,
> de dónde se lee cada dato, y qué queda pendiente.

---

## 0. Estado de implementación

### Prueba en vivo contra PRODUCCIÓN (`https://vpos.infonet.com.py`)

Con las credenciales de `cardnet/backend/config.php` (mismas que usa el portal actual):

| Prueba | Resultado |
|---|---|
| `POST /vpos/api/0.3/single_buy` (Gs. 1.000) | ✅ `status: success`, devuelve `process_id` |
| `GET /checkout/new/{process_id}` (pantalla de pago) | ✅ HTTP 200 (redirect directo sirve; no hace falta iframe) |
| `bancard-checkout-4.0.0.js` (para iframe, opcional) | ✅ HTTP 200 |
| `POST /vpos/api/0.3/single_buy/confirmations` | ⚠️ `PaymentNotFoundError` — no se puede validar sin un pago con tarjeta real completado. **El webhook es la vía autoritativa.** |

`.env` del backend cargado con: `BANCARD_ENV=production`, `BANCARD_BASE_URL=https://vpos.infonet.com.py`,
`BANCARD_PUBLIC_KEY` / `BANCARD_PRIVATE_KEY` (producción, en `.env`, no versionado).

### Bugs corregidos en nuestro código (pre-existentes)

- `PaymentOrder.gatewayRef` guardaba el `process_id` de Bancard; ahora guarda **nuestro** `shop_process_id`
  (es lo que Bancard reenvía en el webhook y lo que `bancardReturn` / `bancardWebhook` usan para buscar la orden).
- `getOrderPublic()` calculaba `externalRedirect` con `!includes('/checkout')`, que también descartaba la
  URL de Bancard (`.../checkout/new/...`). Ahora: URL absoluta que **no** empieza con `FRONTEND_URL`.

**Hecho (commit de esta sesión) — vPOS `single_buy` nativo, sin winsap:**

| Cambio | Archivo |
|---|---|
| `single_buy` nativo + helpers de webhook (`webhookToken`, `parseWebhook`), redirect `/checkout/new/{id}` | `backend/src/services/bancard.service.ts` |
| Endpoint **`POST /api/payments/bancard/webhook`** (valida token MD5, activa Bio-Pass, responde 200) | `backend/src/controllers/payment.controller.ts` + `routes/index.ts` |
| PY: Bancard es el procesador — si falla, error 500 (ya no cae silencioso a transferencia). Alias SIPAP/Tigo queda como *alternativa* secundaria | `backend/src/services/payment.service.ts` |
| `BANCARD_BASE_URL` override + `config.bancard.webhookUrl`; log de URLs al arrancar | `backend/src/config/index.ts`, `backend/src/server.ts`, `.env.example` |
| `paymentLink` (bot WhatsApp + cron) apunta a la página `/checkout?ref=` (muestra monto, estado, polling y botón Bancard) en vez de directo a la pasarela | `payment.service.ts`, `whatsapp/bot-state-machine.ts` |
| Mensaje WhatsApp PY: Bancard primero, SIPAP/Tigo como alternativa | `whatsapp/bot-state-machine.ts` |
| Tests del webhook (firma válida/inválida, aprobado/rechazado, payload malformado) | `backend/src/__tests__/bancard.webhook.test.ts` |
| Brasil (PIX / Mercado Pago) — **sin cambios** (no pasa por winsap) | — |

`npx tsc --noEmit` ✅ · `vitest` 24/24 ✅

**Pendiente (necesita documentación / decisión — ver §3 y §8):**
- Bancard **QR dinámico** como API aparte (hoy el QR lo muestra el checkout de Bancard con `single_buy`).
- **Tokenización + débito automático** de renovaciones (hoy cada renovación genera un `single_buy` nuevo).
- Cargar credenciales reales de staging en el `.env` del deploy y registrar el webhook en el panel Bancard.
- Quitar el redirect a `winsap.com.py` en Dokploy (es config de deploy, no de este repo).

---

## 1. Cómo funciona HOY (lo que hay que reemplazar)

```
App Bio-Pass (WhatsApp / web)
        │  crea "orden de pago"
        ▼
backend PaymentService.createPaymentOrder()
        │  paymentLink  ─────────────►  https://winsap.com.py/  (portal PHP == carpeta cardnet/)
        │                              index.php?valor=&token=&returnUrl=&sig=  (HMAC SHA-256 con SHARED_SECRET)
        │                                   │
        │                                   ├─ Brasil  → MercadoPago SDK (pix / boleto / tarjeta)
        │                                   └─ Paraguay→ Bancard vPOS  POST /vpos/api/0.3/single_buy
        │                                                iframe  bancard-checkout-4.0.0.js  (Bancard.Checkout.createForm)
        │                                   │
        │                              generate_return.php  → firma el status y redirige a returnUrl
        ▼
backend  GET /api/payments/bancard/return?ref=...   (ya existe, controllers/payment.controller.ts)
        │  BancardService.confirm()  → single_buy/confirmations
        ▼
PaymentService.handlePaymentSuccess()  → activa suscripción + QR emergencia + PDF stickers + WhatsApp
```

Archivos del portal actual (copiados en `cardnet/` para referencia):

| Archivo | Rol |
|---|---|
| `cardnet/index.php` | Página de pago pública. Valida `sig` HMAC, muestra selector MercadoPago/Bancard, carga `bancard-checkout-4.0.0.js`. |
| `cardnet/backend/index.php` | API del portal. `POST ?route=payment` (crea single_buy Bancard **o** pago MercadoPago), `GET ?route=payment/status/{id}`, `POST ?route=webhook/bancard`, `POST ?route=webhook/mercadopago`. |
| `cardnet/backend/config.php` | Claves: MercadoPago access token, **Bancard public/private key**, `BANCARD_API_URL`. |
| `cardnet/bancard_return.php` | Recibe el redirect de Bancard (`?shop_id=`), reconstruye la URL larga desde `$_SESSION` y vuelve a `index.php`. |
| `cardnet/generate_return.php` | Firma el resultado (`status|token|valor`) con `SHARED_SECRET` y redirige al `returnUrl` del comercio. |

Token vPOS usado en el portal:
- **single_buy:**  `md5(private_key + shop_process_id + amount + currency)`
- **confirmación / webhook:**  `md5(private_key + shop_process_id + "confirm" + amount + currency)`

---

## 2. Arquitectura objetivo (Bancard nativo, sin winsap)

> Las ramas **QR dinámico** y **tokenización** son opcionales/futuras (§3). Lo implementado
> hoy es la rama `single_buy` + webhook.

```
App Bio-Pass
   ▼
backend PaymentService.createPaymentOrder()
   ├─ Bancard QR dinámico   → POST {VPOS}/vpos/api/0.3/qr/generate        → guarda EMV + imagen en PaymentOrder
   ├─ Bancard single_buy    → POST {VPOS}/vpos/api/0.3/single_buy         → iframe/redirect (tarjeta)   [fallback]
   └─ Bancard tokenización  → POST {VPOS}/vpos/api/0.3/cards/new          → alta de tarjeta para débito recurrente
   ▼
Frontend /checkout  → muestra el QR de Bancard (imagen o EMV) — YA NO se genera con `qrcode` local
   ▼
Bancard → webhook  POST {BASE_URL}/api/payments/bancard/webhook   (confirmación server-to-server)
Bancard → browser  GET  {BASE_URL}/api/payments/bancard/return    (redirect del usuario)
   ▼
PaymentService.handlePaymentSuccess()  (sin cambios)
   ▼
Renovaciones (cron.service)  → PaymentService.chargeTokenizedCard()  → POST {VPOS}/vpos/api/0.3/charge
```

**Se elimina:** salto a `winsap.com.py`, `sig`/HMAC del portal, MercadoPago para Paraguay,
y la generación local del QR de pago (`qrcode.toDataURL` en `pix.service` para PY).
**Se mantiene:** el flujo Brasil PIX tal cual (a confirmar contigo), el QR de **emergencia**
(`qr-pdf.service.ts` — es otra cosa, no es pago), `handlePaymentSuccess`, cron de suscripciones.

---

## 3. Flujos Bancard requeridos y estado de la documentación

| # | Flujo | Para qué | Doc disponible |
|---|---|---|---|
| A | **vPOS `single_buy` + `single_buy/confirmations`** | Pago con tarjeta (checkout alojado / iframe) | ✅ Completa en `cardnet/` |
| B | **Bancard QR dinámico (SIPAP)** — `qr/generate`, consulta de estado, webhook | Generar el QR de pago desde Bancard | ❌ **FALTA** — no está en `cardnet/` |
| C | **Tokenización de tarjetas + `charge`** — `cards/new`, `users/{id}/cards`, `charge`, `cards/delete` | Débito automático de renovaciones | ❌ **FALTA** — no está en `cardnet/` |

### Lo que necesito de tu lado para B y C

1. **PDF / link de la documentación oficial de Bancard** para:
   - "Pagos con QR" / "Bancard QR" (endpoints, campos del request, cómo se arma el `token` md5, formato de la respuesta: ¿devuelve EMV string?, ¿imagen base64?, ¿URL?, tiempo de expiración).
   - "Vault" / "Alias de tarjetas" / "Cobro con token" (endpoints `cards/new`, `charge`, cómo llega el `alias_token` — ¿por webhook?, ¿en el return?).
2. **Credenciales / IDs que asigna Bancard aparte del public/private key:**
   - Número de **comercio** y **sucursal** para QR (`commerce` / `branch`), si aplica.
   - Confirmar si QR y Vault usan el **mismo** public/private key que vPOS o llaves distintas.
3. **URL del panel de Bancard** (staging) donde se cargan los webhooks, o confirmar que se piden por soporte.

Con eso implemento B y C igual de completos que A. Sin eso puedo dejar A funcionando y
B/C cableados con TODOs y variables de entorno, listos para completar en cuanto llegue la doc.

---

## 4. URLs a registrar en Bancard  (lo que pediste "para pasarle a Bancard")

`{BASE_URL}` = dominio público del **backend**.
- Producción: `https://bio-pass.cnid.com.py`  (según `CAMBIOSbiopass20260903.md`; hoy `.env` tiene `BASE_URL` mal, hay que corregir)
- Local/dev: `http://localhost:4000`

| Propósito | Método | URL | Quién la llama |
|---|---|---|---|
| **Webhook confirmación** (single_buy + QR + charge) | `POST` | `{BASE_URL}/api/payments/bancard/webhook` | Bancard → servidor (server-to-server, sin navegador) |
| **Return / redirect** del usuario tras pagar | `GET` | `{BASE_URL}/api/payments/bancard/return?ref={referenceCode}` | Navegador del usuario |
| **Cancel URL** | `GET` | `{FRONTEND_URL}/checkout?ref={referenceCode}&status=cancel` | Navegador del usuario |
| **Alta de tarjeta — return** (flujo C) | `GET` | `{BASE_URL}/api/payments/bancard/card-return?ref={userId}` | Navegador del usuario |
| **Alta de tarjeta — webhook** (flujo C, entrega el `alias_token`) | `POST` | `{BASE_URL}/api/payments/bancard/card-webhook` | Bancard → servidor |

`{FRONTEND_URL}` = `https://bio-pass.cnid.com.py` (mismo origen) / `http://localhost:5173` en dev.

Rutas nuevas a agregar en `backend/src/routes/index.ts`:

```ts
router.post('/payments/bancard/webhook',      PaymentController.bancardWebhook);      // NUEVA
router.get ('/payments/bancard/return',       PaymentController.bancardReturn);       // ya existe
router.get ('/payments/bancard/card-return',  PaymentController.bancardCardReturn);   // NUEVA (flujo C)
router.post('/payments/bancard/card-webhook', PaymentController.bancardCardWebhook);  // NUEVA (flujo C)
```

El webhook de Bancard **no manda `X-Webhook-Secret`**: se valida recalculando el `token` md5
con `BANCARD_PRIVATE_KEY` (como en `cardnet/backend/index.php` línea 460). Hay que exceptuar
esta ruta del chequeo genérico de `webhookSecretValid()`.

---

## 5. De dónde se lee cada dato

### 5.1 Configuración / secretos  (`backend/src/config/index.ts` → `config.bancard`)

| Variable `.env` | Default hoy | Uso | Cambio propuesto |
|---|---|---|---|
| `BANCARD_PUBLIC_KEY` | `''` | `public_key` en cada request | Cargar la real (staging: `BMc1nPbBerjyRKlHcE4lp5mqgbnkluPu`) |
| `BANCARD_PRIVATE_KEY` | `''` | arma el `token` md5 y valida webhooks | staging: `dSWILMujANuX(KT42Nm6UZ0bJvWGpH1BhFd9HHCI` |
| `BANCARD_ENV` | `staging` | elige base URL | — |
| `config.bancard.baseUrl` | `staging → https://vpos.infonet.com.py:8888`, `production → https://vpos.infonet.com.py` | host de la API | **Verificar el host/puerto de staging con Bancard** (el portal PHP usa `https://vpos.infonet.com.py` sin puerto) |
| `BANCARD_COMMERCE` | — (no existe) | nº de comercio para QR | **AGREGAR** si el API de QR lo pide |
| `BANCARD_BRANCH` | — (no existe) | nº de sucursal para QR | **AGREGAR** si el API de QR lo pide |
| `BASE_URL` | `http://localhost:4000` | arma `return_url` / `webhook` | **corregir en prod** a `https://bio-pass.cnid.com.py` |
| `FRONTEND_URL` | `http://localhost:5173` | arma `cancel_url` y `/checkout` | ok |

### 5.2 Datos de la transacción  (`backend/src/services/payment.service.ts`)

| Campo que va a Bancard | Origen exacto |
|---|---|
| `amount` | `config.payments.planPrices.PY.MONTHLY` (35000) / `.ANNUAL` (300000); `+ .FINE` (50000) si `isFine`. Se formatea `toFixed(2)` → `"35000.00"` |
| `currency` | fijo `'PYG'` para Paraguay |
| `shop_process_id` | `Date.now().toString()` (se genera en `createPaymentOrder`). Numérico, único por intento. Se guarda en `PaymentOrder.gatewayRef` |
| `referenceCode` | `` `BIO-${shopProcessId}-${1000..9999}` `` — clave única de `PaymentOrder`, viaja en `return_url` |
| `description` | `` `Bio-Pass ${plan}` `` (single_buy la trunca a 20 chars) |
| `return_url` | `` `${config.baseUrl}/api/payments/bancard/return?ref=${referenceCode}` `` |
| `cancel_url` | `` `${checkoutLink}&status=cancel` `` |
| `token` (md5) | `BANCARD_PRIVATE_KEY` + `shop_process_id` + `amount` + `currency` |

### 5.3 Datos del cliente  (tabla `User` vía Prisma, en `createPaymentOrder`)

`prisma.user.findUnique({ where:{ id: userId }, include:{ organization:true } })` →
`user.fullName`, `user.email`, `user.phoneNumber`, `user.ciNumber`, `user.organization?.name`.
(vPOS `single_buy` **no** requiere datos del pagador; el API de QR / Vault podría pedir CI o email — a confirmar con la doc.)

### 5.4 Estado del pago (lectura)

- `PaymentOrder` (Prisma): `referenceCode`, `gatewayRef` (= `shop_process_id`), `status`, `amount`, `currency`.
- Confirmación: `BancardService.confirm({ shopProcessId, amount, currency })` → `POST single_buy/confirmations`.
- El frontend `/checkout` hace **polling** cada 4 s a `GET /api/payments/{ref}` (`getOrderPublic`).

---

## 6. Cambios de código

### Crear / reescribir
| Archivo | Acción |
|---|---|
| `backend/src/services/bancard.service.ts` | Ampliar: `createQr()`, `getQrStatus()`, `verifyWebhookToken()`, `registerCard()`, `listCards()`, `chargeWithToken()`, `deleteCard()`. Corregir `baseUrl` y `redirectUrl` (`/checkout/new/{id}` vs iframe). |
| `backend/src/services/payment.service.ts` | PY: llamar a `BancardService.createQr()` y guardar EMV/imagen en `PaymentOrder`. Quitar MercadoPago-PY. `chargeTokenizedCard()` para renovaciones. |
| `backend/src/controllers/payment.controller.ts` | `bancardWebhook`, `bancardCardReturn`, `bancardCardWebhook`. Exceptuar webhook Bancard del `X-Webhook-Secret`. |
| `backend/src/routes/index.ts` | 3 rutas nuevas (§4). |
| `backend/src/config/index.ts` | `BANCARD_COMMERCE`, `BANCARD_BRANCH` (si aplica), revisar `baseUrl` staging. |
| `backend/src/services/cron.service.ts` | Renovación: intentar `chargeTokenizedCard()` si el user tiene tarjeta guardada; si no, mandar link/QR como ahora. |
| `frontend/src/pages/Checkout.tsx` | Render del QR de Bancard (imagen/EMV desde la orden) en lugar del bloque PIX para PY. Botón "Guardar tarjeta para renovación automática". |
| `backend/src/whatsapp/bot-state-machine.ts` | Mensajes PY: mostrar QR/monto Bancard, sacar el texto "Transferencia SIPAP" si se decide quitar el fallback. |
| `backend/.env.example` + `.env` | Nuevas variables + valores reales de staging. |

### Modelo de datos (`backend/prisma/schema.prisma`) — migración nueva
```prisma
model PaymentOrder {
  // ...
  bancardProcessId  String?   // process_id de single_buy / QR
  qrEmv             String?   @db.Text   // string EMV del QR Bancard
  qrImage           String?   @db.Text   // imagen base64/URL del QR Bancard
}

model BancardCard {                  // NUEVO — flujo C (débito recurrente)
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  aliasToken    String                 // token de la tarjeta (NO son datos PCI)
  cardMasked    String                 // "**** **** **** 1234"
  cardBrand     String?
  expiryMonth   String?
  expiryYear    String?
  isDefault     Boolean  @default(true)
  createdAt     DateTime @default(now())
  @@index([userId])
}
```
`PaymentGateway` enum ya tiene `BANCARD`. Se puede marcar `MERCADOPAGO`/`TIGO_MONEY` como deprecados.

---

## 7. Plan de implementación por fases

1. **Fase 0 — config & limpieza** (sin romper nada): corregir `baseUrl`/`BASE_URL`, cargar llaves staging, agregar migración `bancardProcessId/qrEmv/qrImage` + `BancardCard`.
2. **Fase 1 — vPOS single_buy nativo** (doc ✅): ruta webhook, validación por token md5, `bancardReturn` ya andando, quitar dependencia de `winsap.com.py`. Probar en staging con tarjetas de prueba Bancard.
3. **Fase 2 — Bancard QR** (requiere doc B): `createQr()`, guardar EMV/imagen, render en `/checkout` y en WhatsApp, consulta de estado + webhook.
4. **Fase 3 — Tokenización + débito recurrente** (requiere doc C): alta de tarjeta, `charge`, integrar en `cron.service`, pantalla de "tarjetas guardadas".
5. **Fase 4 — retiro de MercadoPago/SIPAP** según lo que decidas para Brasil y para el fallback manual PY.

---

## 8. Preguntas abiertas (bloquean Fase 2+)

- [ ] Documentación oficial de **Bancard QR** (endpoints + token + formato de respuesta + expiración).
- [ ] Documentación oficial de **Bancard Vault / tokenización + `charge`**.
- [ ] ¿`commerce`/`branch` para QR? ¿mismas llaves que vPOS?
- [ ] **Brasil:** ¿se deja PIX/MercadoPago como está, o también sale? (winsap hace MercadoPago para BR).
- [ ] **Fallback manual PY** (alias SIPAP + Tigo Money): ¿se mantiene como respaldo o se elimina?
- [ ] Host/puerto real del ambiente **staging** de Bancard (`:8888` vs sin puerto).
- [ ] `SHARED_SECRET` del portal (`TEST_SHARED_SECRET` en `cardnet/`): al sacar winsap deja de usarse — confirmar que ningún otro sistema lo consume.
