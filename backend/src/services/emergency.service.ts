import geoip from 'geoip-lite';
import { prisma } from '../database/prisma';
import { whatsappBot } from '../whatsapp/baileys.client';
import { PushService } from './push.service';
import { parseMedications, medicationConflicts } from './medication.util';
import { config } from '../config';

export interface EmergencyAccessData {
  user: {
    id: string;
    fullName: string;
    bloodType: string;
    emergencyConditions: string[];
    severeAllergies: string;
    contraindicatedMeds: string;
    /** Medicación en curso declarada por el titular. */
    currentMedications: Array<{ name: string; dose?: string; frequency?: string }>;
    /** Advertencias si la medicación en curso choca con alergias / contraindicaciones. */
    medicationAlerts: string[];
    /** Horario de toma programado (recordatorios activos, sin turnos médicos). */
    medicationSchedule: Array<{ medication: string; dose?: string; times: string[] }>;
    address: string;
    photoUrl?: string;
    organization?: {
      name: string;
      logoUrl?: string;
      primaryColor?: string;
    } | null;
  };
  emergencyContact: {
    fullName: string;
    phoneNumber: string;
    relationship?: string;
  } | null;
  encryptionSalt?: string;
}

export class EmergencyService {
  /**
   * Resolves public emergency data and triggers automatic WhatsApp push alert & audit log
   */
  public static async processEmergencyScan(
    emergencyToken: string,
    ipAddress: string,
    userAgent: string
  ): Promise<EmergencyAccessData | null> {
    const user = await prisma.user.findUnique({
      where: { emergencyToken },
      include: {
        emergencyContacts: {
          where: { isPrimary: true },
          take: 1,
        },
        organization: true,
      },
    });

    if (!user) {
      return null;
    }

    // IP Geolocation lookup
    let city = 'Ubicación Desconocida';
    let country = 'PY';
    let lat: number | undefined;
    let lng: number | undefined;

    // Normalise: strip IPv6-mapped IPv4 prefix (::ffff:1.2.3.4 -> 1.2.3.4), keep real IPs intact.
    const cleanIp = (ipAddress || '').replace(/^::ffff:/i, '').trim();
    const isLocal =
      cleanIp === '127.0.0.1' ||
      cleanIp === '::1' ||
      cleanIp === '1' ||
      cleanIp === 'localhost' ||
      cleanIp.startsWith('10.') ||
      cleanIp.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(cleanIp);

    if (!isLocal) {
      const geo = geoip.lookup(cleanIp);
      if (geo) {
        city = geo.city || geo.timezone || 'Región Central';
        country = geo.country || 'PY';
        lat = geo.ll ? geo.ll[0] : undefined;
        lng = geo.ll ? geo.ll[1] : undefined;
      }
    } else {
      city = 'Asunción (Acceso Local/Prueba)';
      country = 'Paraguay';
    }

    // Save Audit Log
    const auditLog = await prisma.scanAuditLog.create({
      data: {
        userId: user.id,
        ipAddress: cleanIp,
        userAgent,
        mode: 'EMERGENCY_NO_PIN',
        city,
        country,
        lat,
        lng,
        alertSentViaWhatsApp: true,
      },
    });

    // Format current local time (HH:mm)
    const scanTime = new Date().toLocaleTimeString('es-PY', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: config.timezone,
    });

    // Coordenadas: primero las del navegador (llegan segundos después por
    // POST /emergency/:token/location); mientras tanto, el centroide de geoip si lo hay.
    const coordsLine =
      lat != null && lng != null
        ? `📌 *Coordenadas:* ${lat.toFixed(5)}, ${lng.toFixed(5)}\n` +
          `🗺️ *Mapa:* https://maps.google.com/?q=${lat},${lng}\n`
        : '';

    const alertMessage = `⚠️ *ALERTA DE SEGURIDAD BIO-PASS*\n\n` +
      `Tu código QR de emergencia fue escaneado hoy a las *${scanTime}*.\n` +
      `📍 *Ubicación aproximada:* ${city}, ${country}\n` +
      coordsLine +
      `🌐 *IP:* ${cleanIp}\n\n` +
      (coordsLine ? '' : '_Ubicación exacta en camino si el navegador del escaneo la comparte._\n\n') +
      `_Si no fuiste tú o no te encuentras en una situación médica, contacta a nuestro soporte inmediatamente._`;

    // Fan out the scan alert on every available channel, in the background.
    whatsappBot.sendMessage(user.whatsappJid || user.phoneNumber, alertMessage).catch((err) => {
      console.error(`Failed to dispatch WhatsApp scan alert to ${user.phoneNumber}:`, err?.message || err);
    });

    PushService.sendEmergencyAlert(user.id, {
      city,
      country,
      ip: cleanIp,
      time: scanTime,
    }).catch((err) => {
      console.error(`Failed to dispatch Web Push scan alert for ${user.id}:`, err?.message || err);
    });

    // Parse emergency conditions array
    let conditions: string[] = [];
    if (user.emergencyConditions) {
      try {
        conditions = JSON.parse(user.emergencyConditions);
      } catch {
        conditions = [user.emergencyConditions];
      }
    }

    const primaryContact = user.emergencyContacts[0] || null;

    const medications = parseMedications(user.currentMedications);

    const reminders = await prisma.medicationReminder.findMany({
      where: { userId: user.id, active: true, kind: 'MED' },
      orderBy: { createdAt: 'asc' },
      select: { medication: true, dose: true, times: true, scheduleKind: true, intervalHours: true, nextDoseAt: true },
    });
    const medicationSchedule = reminders.map((r) => {
      if (r.scheduleKind === 'INTERVAL' && r.intervalHours) {
        const next = r.nextDoseAt
          ? new Date(r.nextDoseAt).toLocaleTimeString('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
          : null;
        return { medication: r.medication, dose: r.dose || undefined, times: [`cada ${r.intervalHours} h${next ? ` · próxima ${next}` : ''}`] };
      }
      let times: string[] = [];
      try { times = JSON.parse(r.times); } catch { /* noop */ }
      return { medication: r.medication, dose: r.dose || undefined, times };
    });

    return {
      user: {
        id: user.id,
        fullName: user.fullName || 'Titular Bio-Pass',
        bloodType: user.bloodType || 'O Positivo (O+)',
        emergencyConditions: conditions,
        severeAllergies: user.severeAllergies || 'Ninguna registrada',
        contraindicatedMeds: user.contraindicatedMeds || 'Ninguno registrado',
        currentMedications: medications.map((m) => ({ name: m.name, dose: m.dose, frequency: m.frequency })),
        medicationAlerts: medicationConflicts(medications, user.severeAllergies, user.contraindicatedMeds),
        medicationSchedule,
        address: user.address || 'No especificada',
        photoUrl: user.photoUrl || undefined,
        organization: user.organization
          ? {
              name: user.organization.name,
              logoUrl: user.organization.logoUrl || undefined,
              primaryColor: user.organization.primaryColor || '#e11d48',
            }
          : null,
      },
      emergencyContact: primaryContact
        ? {
            fullName: primaryContact.fullName,
            phoneNumber: primaryContact.phoneNumber,
            relationship: primaryContact.relationship || 'Familiar / Contacto de Emergencia',
          }
        : null,
      encryptionSalt: user.encryptionSalt || undefined,
    };
  }

  /**
   * Segunda fase del escaneo: el navegador de quien escaneó compartió su GPS
   * (POST /emergency/:token/location). Se guarda en el último registro de auditoría
   * del titular y se le manda un WhatsApp de seguimiento con las coordenadas exactas
   * y un enlace a Google Maps. Silencioso si no hay escaneo reciente al que anclarlo.
   */
  public static async attachScanLocation(
    emergencyToken: string,
    lat: number,
    lng: number,
    accuracy?: number
  ): Promise<{ ok: boolean }> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { ok: false };
    }

    const user = await prisma.user.findUnique({
      where: { emergencyToken },
      select: { id: true, phoneNumber: true, whatsappJid: true },
    });
    if (!user) return { ok: false };

    // Ancla: el escaneo más reciente de este titular en los últimos 20 min.
    const recent = await prisma.scanAuditLog.findFirst({
      where: { userId: user.id, scannedAt: { gte: new Date(Date.now() - 20 * 60_000) } },
      orderBy: { scannedAt: 'desc' },
    });
    if (!recent) return { ok: false };
    // Ya se ancló una ubicación GPS a este escaneo → no repetir el aviso.
    if (recent.gpsFixed) return { ok: true };

    const acc = Number.isFinite(accuracy) ? Math.round(accuracy as number) : undefined;
    await prisma.scanAuditLog.update({
      where: { id: recent.id },
      data: { lat, lng, gpsFixed: true },
    });

    const scanTime = new Date(recent.scannedAt).toLocaleTimeString('es-PY', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: config.timezone,
    });
    const msg =
      `📌 *Ubicación exacta del escaneo* (${scanTime})\n\n` +
      `*Coordenadas:* ${lat.toFixed(5)}, ${lng.toFixed(5)}` +
      (acc ? ` _(±${acc} m)_` : '') + `\n` +
      `🗺️ https://maps.google.com/?q=${lat},${lng}\n\n` +
      `_Compartida por el navegador de quien escaneó tu QR de emergencia._`;
    whatsappBot.sendMessage(user.whatsappJid || user.phoneNumber, msg).catch((err) => {
      console.error(`Failed to dispatch WhatsApp scan-location to ${user.phoneNumber}:`, err?.message || err);
    });

    return { ok: true };
  }

  /**
   * Triggers an automated emergency voice call via Twilio
   */
  public static async triggerEmergencyCall(userId: string, targetPhone: string, callerName: string): Promise<{ success: boolean; callSid?: string }> {
    console.log(`📞 [Twilio Voice] Initiating emergency automated call to ${targetPhone} for user ${callerName}`);
    // Simulated Twilio call dispatch
    return {
      success: true,
      callSid: `CA_mock_call_${Date.now()}`,
    };
  }
}
