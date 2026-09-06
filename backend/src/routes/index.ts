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

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

// Authentication (OTP via WhatsApp + PIN)
router.post('/auth/request-otp', otpRequestLimiter, authLimiter, AuthController.requestOtp);
router.post('/auth/verify-login', authLimiter, AuthController.verifyLogin);
router.post('/auth/register-step', registerLimiter, upload.single('media'), AuthController.registerStep);
router.get('/auth/profile', authMiddleware, AuthController.getProfile);

// Emergency & Rescuer Access (Public & Consultation Mode)
router.get('/emergency/:token', emergencyLimiter, EmergencyController.getEmergencyCard);
router.post('/emergency/:token/consultation', emergencyLimiter, EmergencyController.unlockConsultationMode);
router.post('/emergency/:token/call-contact', emergencyLimiter, EmergencyController.callEmergencyContact);

// Zero-Knowledge vault (client-side re-encryption on first web login)
router.get('/vault/status', authMiddleware, VaultController.status);
router.post('/vault/reinitialize', authMiddleware, VaultController.reinitialize);

// Medical Vault & Studies
router.get('/medical/studies', authMiddleware, MedicalController.getStudies);
router.post('/medical/studies/upload', authMiddleware, upload.single('file'), MedicalController.uploadStudy);
router.put('/medical/profile', authMiddleware, MedicalController.updateProfile);

// Payments & Subscriptions
router.post('/payments/create-order', optionalAuthMiddleware, PaymentController.createOrder);
router.post('/payments/webhook', PaymentController.webhook);
router.get('/payments/methods', PaymentController.getPaymentMethods);
router.post('/payments/bancard/webhook', PaymentController.bancardWebhook);
router.get('/payments/bancard/return', PaymentController.bancardReturn);
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
router.get('/bot/status', BotController.getBotStatus);
router.post('/bot/reconnect', BotController.reconnect);
router.post('/bot/simulate-message', upload.single('media'), BotController.simulateMessage);
router.post('/bot/run-cron', BotController.triggerCronCheck);

// ---- Admin panel ----
router.post('/admin/login', AdminController.login);
router.get('/admin/stats', requireAdmin, AdminController.stats);
router.get('/admin/users', requireAdmin, AdminController.listUsers);
router.get('/admin/users/:id', requireAdmin, AdminController.getUser);
router.patch('/admin/users/:id', requireAdmin, AdminController.updateUser);
router.patch('/admin/users/:id/status', requireAdmin, AdminController.setUserStatus);
router.post('/admin/users/:id/unlock-pin', requireAdmin, AdminController.unlockPin);
router.post('/admin/users/:id/reset-pin', requireAdmin, AdminController.resetPin);
router.post('/admin/users/:id/extend', requireAdmin, AdminController.extendSubscription);
router.delete('/admin/users/:id', requireAdmin, AdminController.deleteUser);
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


export default router;
