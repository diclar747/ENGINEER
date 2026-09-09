export interface Medication {
  name: string;
  dose?: string;
  frequency?: string;
  since?: string;
  source?: 'manual' | 'receta' | 'photo';
  addedAt?: string;
}

export interface User {
  id: string;
  phoneNumber: string;
  fullName: string;
  ciNumber?: string;
  bloodType?: string;
  emergencyConditions?: string[] | string;
  severeAllergies?: string;
  contraindicatedMeds?: string;
  /** JSON string en la DB; array ya parseado cuando lo entrega la API. */
  currentMedications?: Medication[] | string;
  address?: string;
  email?: string;
  photoUrl?: string;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PURGED';
  emergencyToken: string;
  encryptionSalt?: string;
  encryptedMedicalBlob?: string;
  organization?: {
    name: string;
    logoUrl?: string;
    primaryColor?: string;
  } | null;
  emergencyContacts?: EmergencyContact[];
}

export interface EmergencyContact {
  id?: string;
  fullName: string;
  phoneNumber: string;
  relationship?: string;
  isPrimary?: boolean;
}

export interface Reminder {
  id: string;
  kind: 'MED' | 'APPOINTMENT';
  scheduleKind?: 'CLOCK' | 'INTERVAL' | null;
  medication: string;
  dose?: string | null;
  times: string[];
  intervalHours?: number | null;
  anchorAt?: string | null;
  nextDoseAt?: string | null;
  leadMinutes?: number | null;
  whenAt?: string | null;
  active: boolean;
}

export interface MedicalStudy {
  id: string;
  title: string;
  studyType: 'LABORATORY' | 'XRAY' | 'TOMOGRAPHY' | 'PRESCRIPTION' | 'CARDIOLOGY' | 'OTHER';
  studyDate: string;
  fileUrl: string;
  ocrRawText?: string;
  aiSummary?: string;
  createdAt: string;
}

export interface ScanAuditLog {
  id: string;
  scannedAt: string;
  ipAddress?: string;
  userAgent?: string;
  mode: 'EMERGENCY_NO_PIN' | 'CONSULTATION_PIN';
  city?: string;
  country?: string;
  alertSentViaWhatsApp: boolean;
}

export interface DecryptedMedicalHistory {
  patientName?: string;
  bloodType?: string;
  allergies?: string[];
  chronicDiseases?: Array<{
    condition: string;
    diagnosedYear: number;
    treatment: string;
  }>;
  surgeries?: Array<{
    name: string;
    year: number;
    hospital: string;
  }>;
  vaccines?: Array<{
    name: string;
    year: number;
    validUntil: string;
  }>;
  consultationsHistory?: Array<{
    date: string;
    specialty: string;
    doctor: string;
    diagnosis: string;
  }>;
}
