import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { adminCredentialsOk, generateAdminToken, AdminRequest } from '../security/admin';

const PAGE = 20;
const qs = (v: unknown) => String(v ?? '').trim();

export class AdminController {
  static async login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body || {};
    if (!email || !password || !adminCredentialsOk(String(email), String(password))) {
      res.status(401).json({ error: 'Credenciales incorrectas' });
      return;
    }
    res.json({ token: generateAdminToken(String(email).toLowerCase().trim()), email });
  }

  static async stats(_req: AdminRequest, res: Response): Promise<void> {
    const [users, active, pending, paidOrders, pendingOrders, studies, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: 'PENDING_PAYMENT' } }),
      prisma.paymentOrder.count({ where: { status: 'PAID' } }),
      prisma.paymentOrder.count({ where: { status: 'PENDING' } }),
      prisma.medicalStudy.count(),
      prisma.paymentOrder.aggregate({ _sum: { amount: true }, where: { status: 'PAID' } }),
    ]);
    res.json({ users, active, pending, paidOrders, pendingOrders, studies, revenue: revenue._sum.amount || 0 });
  }

  static async listUsers(req: AdminRequest, res: Response): Promise<void> {
    const page = Math.max(1, parseInt(qs(req.query.page) || '1', 10));
    const search = qs(req.query.search);
    const status = qs(req.query.status);
    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { phoneNumber: { contains: search } },
        { fullName: { contains: search, mode: 'insensitive' } },
        { ciNumber: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        select: {
          id: true, phoneNumber: true, fullName: true, ciNumber: true, email: true,
          bloodType: true, status: true, createdAt: true,
          subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, select: { plan: true, expiryDate: true, status: true } },
          _count: { select: { medicalStudies: true, paymentOrders: true } },
        },
      }),
    ]);
    res.json({ total, page, pageSize: PAGE, rows });
  }

  static async getUser(req: AdminRequest, res: Response): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        emergencyContacts: true,
        subscriptions: { orderBy: { createdAt: 'desc' } },
        paymentOrders: { orderBy: { createdAt: 'desc' }, take: 20 },
        medicalStudies: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, studyType: true, fileUrl: true, createdAt: true },
        },
      },
    });
    if (!user) { res.status(404).json({ error: 'No encontrado' }); return; }
    res.json({ user });
  }

  static async setUserStatus(req: AdminRequest, res: Response): Promise<void> {
    const { status } = req.body || {};
    const allowed = ['ACTIVE', 'PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'];
    if (!allowed.includes(status)) { res.status(400).json({ error: 'Estado invalido' }); return; }
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { status } });
    res.json({ ok: true, status: user.status });
  }

  static async listPayments(req: AdminRequest, res: Response): Promise<void> {
    const page = Math.max(1, parseInt(qs(req.query.page) || '1', 10));
    const status = qs(req.query.status);
    const where: any = {};
    if (status) where.status = status;
    const [total, rows] = await Promise.all([
      prisma.paymentOrder.count({ where }),
      prisma.paymentOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { user: { select: { fullName: true, phoneNumber: true } } },
      }),
    ]);
    res.json({ total, page, pageSize: PAGE, rows });
  }

  static async markPaid(req: AdminRequest, res: Response): Promise<void> {
    const { PaymentService } = await import('../services/payment.service');
    const ok = await PaymentService.handlePaymentSuccess(req.params.ref);
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'Orden no encontrada o ya pagada' });
  }

  static async listConditions(_req: AdminRequest, res: Response): Promise<void> {
    res.json({ rows: await prisma.medicalConditionOption.findMany({ orderBy: { sortOrder: 'asc' } }) });
  }
  static async createCondition(req: AdminRequest, res: Response): Promise<void> {
    const { code, labelEs, labelGn, sortOrder, active } = req.body || {};
    if (!code || !labelEs) { res.status(400).json({ error: 'code y labelEs son obligatorios' }); return; }
    try {
      const row = await prisma.medicalConditionOption.create({
        data: {
          code: String(code), labelEs: String(labelEs), labelGn: String(labelGn || labelEs),
          sortOrder: Number(sortOrder) || 0, active: active !== false,
        },
      });
      res.json({ row });
    } catch {
      res.status(409).json({ error: 'Ese codigo ya existe' });
    }
  }
  static async updateCondition(req: AdminRequest, res: Response): Promise<void> {
    const { labelEs, labelGn, sortOrder, active } = req.body || {};
    const data: any = {};
    if (labelEs !== undefined) data.labelEs = String(labelEs);
    if (labelGn !== undefined) data.labelGn = String(labelGn);
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder);
    if (active !== undefined) data.active = !!active;
    const row = await prisma.medicalConditionOption.update({ where: { id: req.params.id }, data });
    res.json({ row });
  }
  static async deleteCondition(req: AdminRequest, res: Response): Promise<void> {
    await prisma.medicalConditionOption.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }

  static async getSettings(_req: AdminRequest, res: Response): Promise<void> {
    const rows = await prisma.appSetting.findMany();
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  }
  static async putSettings(req: AdminRequest, res: Response): Promise<void> {
    const entries = Object.entries(req.body || {});
    for (const [key, value] of entries) {
      await prisma.appSetting.upsert({
        where: { key }, create: { key, value: String(value) }, update: { value: String(value) },
      });
    }
    res.json({ ok: true, count: entries.length });
  }
}
