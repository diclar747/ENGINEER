# Doorway Cortex Bio-Pass — Diagrama Entidad-Relación

> Generado a partir de `backend/prisma/schema.prisma`. La base es PostgreSQL (Prisma ORM).
> Render: pegar en cualquier visor Mermaid (GitHub, mermaid.live) o en la doc del repo.

```mermaid
erDiagram
    User ||--o{ EmergencyContact   : "tiene"
    User ||--o{ MedicalStudy       : "sube"
    User ||--o{ MedicationReminder : "programa"
    User ||--o{ Subscription       : "contrata"
    User ||--o{ PaymentOrder       : "genera"
    User ||--o{ ScanAuditLog       : "es escaneado en"
    User ||--o{ PushSubscription   : "registra"
    User }o--o| Organization        : "pertenece a (co-branding)"
    Subscription ||--o{ PaymentOrder : "se paga con"

    User {
        string   id PK
        string   phoneNumber UK "identidad maestra (validada por WhatsApp/OTP)"
        string   whatsappJid  "JID real: <num>@s.whatsapp.net o <lid>@lid"
        Language language      "ES | GN | PT | EN"
        string   fullName
        string   ciNumber
        string   ciFrontUrl
        string   ciBackUrl
        string   dateOfBirth   "DD/MM/YYYY (OCR)"
        string   birthPlace
        string   sex
        string   bloodType     "RH — O+, A-, ..."
        string   emergencyConditions "JSON: [\"Diabetes\",...]"
        string   severeAllergies
        string   contraindicatedMeds
        string   currentMedications  "JSON: [{name,dose,frequency,...}]"
        string   address
        string   email
        string   photoUrl
        string   pinHash            "bcrypt del PIN de 4 dígitos"
        string   encryptionSalt     "salt PBKDF2 para AES-256-GCM"
        string   encryptedMedicalBlob "blob ZK (historial privado)"
        boolean  webVaultInitialized
        string   emergencyToken UK  "UUID público del QR (/e/:token)"
        string   onboardingState    "máquina de estados del bot"
        string   onboardingData     "buffer JSON temporal del registro"
        UserStatus status           "PENDING_PAYMENT | ACTIVE | EXPIRED | CANCELLED | PURGED"
        int      failedPinAttempts
        datetime pinLockedUntil
        string   organizationId FK
        datetime createdAt
        datetime updatedAt
    }

    EmergencyContact {
        string   id PK
        string   userId FK
        string   fullName
        string   phoneNumber
        string   relationship "Madre, Esposa, ..."
        boolean  isPrimary
    }

    MedicalStudy {
        string    id PK
        string    userId FK
        string    title
        StudyType studyType "LABORATORY | XRAY | TOMOGRAPHY | PRESCRIPTION | CARDIOLOGY | OTHER"
        datetime  studyDate
        string    fileUrl
        string    ocrRawText        "texto OCR (cifrado at-rest)"
        string    aiSummary         "resumen IA (cifrado at-rest)"
        string    encryptedMetadata "anotaciones ZK"
        datetime  createdAt
    }

    MedicationReminder {
        string   id PK
        string   userId FK
        string   kind        "MED | APPOINTMENT"
        string   medication  "fármaco / descripción del turno"
        string   dose
        string   times       "MED: JSON [\"08:00\",\"20:00\"] hora local PY"
        datetime whenAt       "APPOINTMENT: fecha/hora del turno"
        boolean  active
        datetime lastSentAt
        string   lastSentSlot
    }

    Subscription {
        string            id PK
        string            userId FK
        PlanType          plan     "MONTHLY | ANNUAL"
        CountryCode       country  "PARAGUAY | BRASIL | OTHER"
        string            currency "PYG | BRL | USD"
        float             amount
        UserStatus        status
        datetime          startDate
        datetime          expiryDate
        NotificationStage lastNotification "NONE | D_MINUS_5 | D_0 | D_PLUS_3 | D_PLUS_4_CANCELLED | PURGED"
        boolean           finePending
        float             fineAmount
    }

    PaymentOrder {
        string         id PK
        string         userId FK
        string         subscriptionId FK
        PaymentGateway gateway "MERCADOPAGO | TIGO_MONEY | PIX | BANCARD | BANK_TRANSFER | WINSAP"
        string         paymentMethod "ALIAS | PIX | LINK | QR | CARD"
        string         referenceCode UK
        string         pixPayload    "BR Code copia-e-cola"
        string         pixQrImage    "data:image/png;base64"
        string         aliasInfo     "SIPAP / Alias bancario PY"
        string         paymentLink
        string         gatewayRef    "id externo del PSP / Bancard process_id"
        string         bancardProcessIds "JSON de todos los shop_process_id"
        float          amount
        string         currency
        PaymentStatus  status "PENDING | PAID | EXPIRED | FAILED"
        datetime       expiresAt
        datetime       paidAt
    }

    ScanAuditLog {
        string   id PK
        string   userId FK
        datetime scannedAt
        string   ipAddress
        string   userAgent
        ScanMode mode "EMERGENCY_NO_PIN | CONSULTATION_PIN"
        string   city
        string   country
        float    lat
        float    lng
        boolean  alertSentViaWhatsApp
    }

    Organization {
        string id PK
        string name
        string slug UK
        string logoUrl "co-branding en el sticker"
        string primaryColor
        string customMessage
    }

    OtpCode {
        string     id PK
        string     phoneNumber
        string     codeHash "bcrypt del código de 6 dígitos"
        OtpPurpose purpose  "LOGIN | PROFILE_CHANGE"
        int        attempts
        datetime   consumedAt
        datetime   expiresAt
    }

    PushSubscription {
        string id PK
        string userId FK
        string endpoint UK
        string p256dh
        string auth
    }

    EmailLog {
        string      id PK
        string      to
        string      subject
        string      template
        EmailStatus status "SENT | FAILED | LOGGED"
        string      error
    }

    AiPrompt {
        string  id PK
        string  name
        string  scope "GENERAL | PRE_REGISTRO | MIEMBRO_ACTIVO"
        string  content
        boolean active
        int     sortOrder
    }

    MedicalConditionOption {
        string  id PK
        string  code UK
        string  labelEs
        string  labelGn
        int     sortOrder
        boolean active
    }

    AppSetting {
        string key PK
        string value
    }

    BotMessage {
        string key PK
        string textEs
        string textGn
    }
```

## Notas de modelo

- **Identidad**: `User.phoneNumber` es la clave natural. La sesión web se abre con `phoneNumber + OTP + PIN`.
- **Zero-Knowledge**: `encryptedMedicalBlob` se cifra/descifra en el navegador (AES-256-GCM, clave PBKDF2 de `PIN + encryptionSalt`). El servidor guarda solo `pinHash` (bcrypt) y el blob cifrado. `MedicalStudy.ocrRawText` / `aiSummary` van cifrados at-rest con clave KMS del servidor (la carga por WhatsApp no tiene el PIN en claro).
- **Emergencia pública**: `emergencyToken` (UUID) resuelve la ficha sin PIN. Los campos que ve el brigadista (`bloodType`, `emergencyConditions`, `severeAllergies`, `contraindicatedMeds`, contacto) quedan legibles por diseño.
- **Cobranzas**: `Subscription` 1—N `PaymentOrder`. El CRON diario recorre `Subscription.expiryDate` y avanza `lastNotification` por etapas (D-5 → D+30 purga).
- **`onDelete: Cascade`** en todas las relaciones hijas de `User`, salvo `Organization` (SetNull implícito) y `Subscription`←`PaymentOrder`.
