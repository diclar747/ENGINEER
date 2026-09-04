import { PrismaClient } from '@prisma/client';
import { ZeroKnowledgeSecurity } from '../src/security/zero-knowledge';
import { config } from '../src/config';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database with demo patient and organizations...');

  // Create demo organization with co-branding
  const org = await prisma.organization.upsert({
    where: { slug: 'club-olimpia-corporativo' },
    update: {},
    create: {
      name: 'Club Olimpia - Dpto. Médico',
      slug: 'club-olimpia-corporativo',
      logoUrl: 'https://images.unsplash.com/photo-1543351611-58f69d7c1781?w=150',
      primaryColor: '#0f172a',
      customMessage: 'Afiliado Oficial - Cobertura de Emergencia',
    },
  });

  const pin = '8492';
  const salt = ZeroKnowledgeSecurity.generateSalt(16);
  const pinHash = await ZeroKnowledgeSecurity.hashPin(pin);

  // Private medical history to be zero-knowledge encrypted
  const privateMedicalHistory = {
    patientName: 'Juan Carlos Silva Gomez',
    bloodType: 'O+',
    rhFactor: 'Positivo',
    allergies: ['Penicilina G Sódica (Anafilaxia)', 'AINEs (Ibuprofeno)', 'Maní'],
    chronicDiseases: [
      { condition: 'Diabetes Mellitus Tipo 2', diagnosedYear: 2019, treatment: 'Metformina 850mg c/12h' },
      { condition: 'Hipertensión Arterial Primaria', diagnosedYear: 2021, treatment: 'Losartán 50mg/día' },
    ],
    surgeries: [
      { name: 'Apendicectomía Laparoscópica', year: 2018, hospital: 'Hospital Bautista Asunción' },
    ],
    vaccines: [
      { name: 'Antitetánica', year: 2024, validUntil: 2034 },
      { name: 'Fiebre Amarilla', year: 2020, validUntil: 'Vitalicia' },
    ],
    consultationsHistory: [
      { date: '2026-02-15', specialty: 'Cardiología', doctor: 'Dr. Alejandro Benítez', diagnosis: 'Control anual satisfactorio. ECG normal.' },
      { date: '2025-11-20', specialty: 'Endocrinología', doctor: 'Dra. Patricia Ortiz', diagnosis: 'HbA1c en 6.1%. Buen control metabólico.' },
    ],
  };

  const encryptedMedicalBlob = ZeroKnowledgeSecurity.encryptWithPin(privateMedicalHistory, pin, salt);

  // Upsert user
  const user = await prisma.user.upsert({
    where: { phoneNumber: '595981123456' },
    update: {
      fullName: 'Juan Carlos Silva Gomez',
      ciNumber: '4892310',
      bloodType: 'O Positivo (O+)',
      emergencyConditions: JSON.stringify(['Diabetes', 'Hipertensión', 'Alergia Severa a Penicilina']),
      severeAllergies: 'Penicilina, Ibuprofeno, Maní',
      contraindicatedMeds: 'Penicilina, Amoxicilina, Ampicilina, Ketorolac, Ibuprofeno',
      address: 'Avda. Mariscal López 3450 c/ Kubitschek, Asunción, Paraguay',
      email: 'juan.silva@doorwaycortex.com',
      photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300',
      pinHash,
      encryptionSalt: salt,
      encryptedMedicalBlob,
      status: 'ACTIVE',
      onboardingState: 'ACTIVE_MEMBER',
      organizationId: org.id,
      emergencyToken: 'demo-user-emergency-token-2026',
    },
    create: {
      phoneNumber: '595981123456',
      fullName: 'Juan Carlos Silva Gomez',
      ciNumber: '4892310',
      bloodType: 'O Positivo (O+)',
      emergencyConditions: JSON.stringify(['Diabetes', 'Hipertensión', 'Alergia Severa a Penicilina']),
      severeAllergies: 'Penicilina, Ibuprofeno, Maní',
      contraindicatedMeds: 'Penicilina, Amoxicilina, Ampicilina, Ketorolac, Ibuprofeno',
      address: 'Avda. Mariscal López 3450 c/ Kubitschek, Asunción, Paraguay',
      email: 'juan.silva@doorwaycortex.com',
      photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300',
      pinHash,
      encryptionSalt: salt,
      encryptedMedicalBlob,
      status: 'ACTIVE',
      onboardingState: 'ACTIVE_MEMBER',
      organizationId: org.id,
      emergencyToken: 'demo-user-emergency-token-2026',
    },
  });

  // Emergency contact
  await prisma.emergencyContact.deleteMany({ where: { userId: user.id } });
  await prisma.emergencyContact.create({
    data: {
      userId: user.id,
      fullName: 'Dra. María Elena Gómez (Madre)',
      phoneNumber: '+595981999888',
      relationship: 'Madre / Médico de Cabecera',
      isPrimary: true,
    },
  });

  // Medical Studies
  await prisma.medicalStudy.deleteMany({ where: { userId: user.id } });
  await prisma.medicalStudy.createMany({
    data: [
      {
        userId: user.id,
        title: 'Perfil Bioquímico Completo y Hemograma',
        studyType: 'LABORATORY',
        studyDate: new Date('2026-01-20'),
        fileUrl: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800',
        aiSummary: 'Glucosa: 95 mg/dL. HbA1c: 6.0%. Colesterol Total: 178 mg/dL. Función renal conservada.',
        ocrRawText: 'LABORATORIO CLINICO CENTRAL - Hemograma Completo: Leucocitos 6.500/mm3, Plaquetas 240.000.',
      },
      {
        userId: user.id,
        title: 'Tomografía Axial Computarizada (TAC) de Tórax',
        studyType: 'TOMOGRAPHY',
        studyDate: new Date('2025-10-12'),
        fileUrl: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800',
        aiSummary: 'Parénquima pulmonar sin consolidaciones. Estructuras mediastínicas y vasculares sin alteraciones.',
        ocrRawText: 'INFORME TOMOGRAFIA COMPUTADA MULTICORTE: Sin derrame pleural. Silueta cardíaca dentro de límites.',
      },
      {
        userId: user.id,
        title: 'Electrocardiograma Basal de 12 Derivaciones',
        studyType: 'CARDIOLOGY',
        studyDate: new Date('2026-02-15'),
        fileUrl: 'https://images.unsplash.com/photo-1530497610245-94d3c16cda28?w=800',
        aiSummary: 'Ritmo Sinusal Regular a 68 lpm. Eje eléctrico normal a +45°. Sin signos de isquemia.',
        ocrRawText: 'TRAZADO ECG: PR 0.16s, QRS 0.08s, QTc 410ms. Trazado compatible con normalidad.',
      },
    ],
  });

  // Active annual subscription
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 320); // 320 days left

  await prisma.subscription.deleteMany({ where: { userId: user.id } });
  await prisma.subscription.create({
    data: {
      userId: user.id,
      plan: 'ANNUAL',
      country: 'PARAGUAY',
      currency: 'PYG',
      amount: config.payments.planPrices.PY.ANNUAL,
      status: 'ACTIVE',
      expiryDate,
    },
  });

  console.log(`✅ Database seeded successfully!`);
  console.log(`👤 Demo Patient: ${user.fullName} (${user.phoneNumber})`);
  console.log(`🔐 Demo PIN: ${pin}`);
  console.log(`🌐 Emergency Token URL: http://localhost:5173/e/${user.emergencyToken}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
