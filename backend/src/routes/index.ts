import { Router } from 'express';
import multer from 'multer';
import { AuthController } from '../controllers/auth.controller';
import { EmergencyController } from '../controllers/emergency.controller';
import { MedicalController } from '../controllers/medical.controller';
import { PaymentController } from '../controllers/payment.controller';
import { ExportController } from '../controllers/export.controller';
import { StickerController } from '../controllers/sticker.controller';
import { BotController } from '../controllers/bot.controller';
import { AdminController } from '../controllers/admin.controller';
import { requireAdmin } from '../security/admin';
import { PushController } from '../controllers/push.controller';
import { VaultController } from '../controllers/vault.controller';
import { authMiddleware, optionalAuthMiddleware } from '../security/jwt';
import { authLimiter, otpRequestLimiter, emergencyLimiter, registerLimiter } from '../security/rate-limit';
import { TERMS_HTML } from '../legal/terms';

const router = Router();

// Términos y Condiciones (enlazado por el bot en el registro y por la web).
router.get('/legal/terminos', (_req, res) => {
  res.type('html').send(TERMS_HTML);
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

// Authentication (OTP via WhatsApp + PIN)
router.post('/auth/request-otp', otpRequestLimiter, authLimiter, AuthController.requestOtp);
router.post('/auth/verify-login', authLimiter, AuthController.verifyLogin);
router.post('/auth/register-step', registerLimiter, upload.single('media'), AuthController.registerStep);
router.get('/auth/profile', authMiddleware, AuthController.getProfile);
router.put('/auth/pin', authMiddleware, authLimiter, AuthController.changePin);
router.post('/auth/phone/request-otp', authMiddleware, otpRequestLimiter, authLimiter, AuthController.requestPhoneChange);
router.put('/auth/phone', authMiddleware, authLimiter, AuthController.confirmPhoneChange);

// Emergency & Rescuer Access (Public & Consultation Mode)
router.get('/emergency/:token', emergencyLimiter, EmergencyController.getEmergencyCard);
router.post('/emergency/:token/location', emergencyLimiter, EmergencyController.reportScanLocation);
router.post('/emergency/:token/consultation', emergencyLimiter, EmergencyController.unlockConsultationMode);
router.post('/emergency/:token/call-contact', emergencyLimiter, EmergencyController.callEmergencyContact);

// Zero-Knowledge vault (client-side re-encryption on first web login)
router.get('/vault/status', authMiddleware, VaultController.status);
router.post('/vault/reinitialize', authMiddleware, VaultController.reinitialize);

// Medical Vault & Studies
router.get('/medical/studies', authMiddleware, MedicalController.getStudies);
router.post('/medical/studies/upload', authMiddleware, upload.single('file'), MedicalController.uploadStudy);
router.put('/medical/profile', authMiddleware, MedicalController.updateProfile);

// Recordatorios de medicación / turnos (calendario del titular — mismos registros que usa el bot)
router.get('/medical/reminders', authMiddleware, MedicalController.getReminders);
router.post('/medical/reminders', authMiddleware, MedicalController.createReminder);
router.patch('/medical/reminders/:id', authMiddleware, MedicalController.updateReminder);
router.delete('/medical/reminders/:id', authMiddleware, MedicalController.deleteReminder);

// Payments & Subscriptions
router.post('/payments/create-order', optionalAuthMiddleware, PaymentController.createOrder);
router.post('/payments/webhook', PaymentController.webhook);
router.get('/payments/methods', PaymentController.getPaymentMethods);
router.post('/payments/bancard/webhook', PaymentController.bancardWebhook);
router.get('/payments/bancard/return', PaymentController.bancardReturn);
router.post('/payments/:ref/bancard-session', PaymentController.bancardSession);
router.post('/payments/:ref/dev-confirm', PaymentController.devConfirm);
router.get('/payments/:ref', PaymentController.getOrder);

// Data Portability & Export (Encrypted ZIP with PIN)
router.post('/export/full-vault', authMiddleware, ExportController.createFullExport);
router.get('/export/download/:filename', ExportController.downloadExportFile);

// QR & Physical Stickers (3x3 cm PDF)
router.get('/stickers/:token/pdf', StickerController.downloadStickerPdf);
router.get('/stickers/:token/png', StickerController.getQrPng);
router.post('/stickers/co-branding', authMiddleware, upload.single('logo'), StickerController.updateCoBranding);

// Web Push notifications (VAPID)
router.get('/push/vapid-public-key', PushController.getVapidPublicKey);
router.post('/push/subscribe', optionalAuthMiddleware, PushController.subscribe);
router.post('/push/unsubscribe', PushController.unsubscribe);
router.post('/push/test', authMiddleware, PushController.test);

// WhatsApp Bot & Automation
// Público: solo el número del bot (para el link "registrate por WhatsApp" del login).
router.get('/bot/public-info', BotController.publicInfo);
// Estado completo + QR + operaciones del bot: SOLO admin.
router.get('/bot/status', requireAdmin, BotController.getBotStatus);
router.get('/admin/bot/status', requireAdmin, BotController.getBotStatus);
router.get('/admin/bot/events', requireAdmin, BotController.getEvents);
router.get('/admin/bot/messages', requireAdmin, AdminController.listBotMessages);
router.delete('/admin/bot/messages/:id', requireAdmin, AdminController.deleteBotMessage);
router.post('/admin/bot/messages/delete', requireAdmin, AdminController.deleteBotMessages);
router.get('/admin/bot/lookup', requireAdmin, BotController.lookup);
router.post('/admin/bot/send-test', requireAdmin, BotController.sendTest);
router.post('/bot/reconnect', requireAdmin, BotController.reconnect);
router.post('/bot/simulate-message', requireAdmin, upload.single('media'), BotController.simulateMessage);
router.post('/bot/run-cron', requireAdmin, BotController.triggerCronCheck);
router.post('/bot/run-reminders', requireAdmin, BotController.triggerReminders);

// ---- Admin panel ----
router.post('/admin/login', AdminController.login);
router.get('/admin/stats', requireAdmin, AdminController.stats);
router.get('/admin/dashboard', requireAdmin, AdminController.dashboard);
router.get('/admin/movements', requireAdmin, AdminController.movements);
router.get('/admin/users', requireAdmin, AdminController.listUsers);
router.get('/admin/users/:id', requireAdmin, AdminController.getUser);
router.patch('/admin/users/:id', requireAdmin, AdminController.updateUser);
router.patch('/admin/users/:id/status', requireAdmin, AdminController.setUserStatus);
router.post('/admin/users/:id/unlock-pin', requireAdmin, AdminController.unlockPin);
router.post('/admin/users/:id/reset-pin', requireAdmin, AdminController.resetPin);
router.post('/admin/users/:id/extend', requireAdmin, AdminController.extendSubscription);
router.delete('/admin/users/:id', requireAdmin, AdminController.deleteUser);
router.get('/admin/subscriptions/export', requireAdmin, AdminController.exportSubscriptions);
router.get('/admin/subscriptions', requireAdmin, AdminController.listSubscriptions);
router.get('/admin/payments/export', requireAdmin, AdminController.exportPayments);
router.get('/admin/payments', requireAdmin, AdminController.listPayments);
router.post('/admin/payments/:ref/mark-paid', requireAdmin, AdminController.markPaid);
router.get('/admin/conditions', requireAdmin, AdminController.listConditions);
router.post('/admin/conditions', requireAdmin, AdminController.createCondition);
router.patch('/admin/conditions/:id', requireAdmin, AdminController.updateCondition);
router.delete('/admin/conditions/:id', requireAdmin, AdminController.deleteCondition);
router.get('/admin/settings', requireAdmin, AdminController.getSettings);
router.put('/admin/settings', requireAdmin, AdminController.putSettings);
router.delete('/admin/users/:id/reminders/:rid', requireAdmin, AdminController.deleteReminder);
router.get('/admin/ai-prompts', requireAdmin, AdminController.listAiPrompts);
router.post('/admin/ai-prompts', requireAdmin, AdminController.createAiPrompt);
router.patch('/admin/ai-prompts/:id', requireAdmin, AdminController.updateAiPrompt);
router.delete('/admin/ai-prompts/:id', requireAdmin, AdminController.deleteAiPrompt);


export default router;
