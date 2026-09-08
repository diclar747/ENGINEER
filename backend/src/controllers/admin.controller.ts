import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { adminCredentialsOk, generateAdminToken, AdminRequest } from '../security/admin';
import { AiPromptService } from '../services/ai-prompt.service';

const PAGE = 20;
const qs = (v: unknown) => String(v ?? '').trim();

/** Construye el filtro Prisma de PaymentOrder desde el query (compartido por lista y export). */
function paymentWhere(q: Record<string, unknown>): any {
  const where: any = {};
  const status = qs(q.status);
  const gateway = qs(q.gateway);
  const method = qs(q.method);
  const from = qs(q.from);
  const to = qs(q.to);
  if (status) where.status = status;
  if (gateway) where.gateway = gateway;
  if (method) where.paymentMethod = { contains: method, mode: 'insensitive' };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999`);
  }
  return where;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Filtro Prisma de Subscription desde el query (lista, export). */
function subscriptionWhere(q: Record<string, unknown>): any {
  const where: any = {};
  const filter = qs(q.filter) || 'all';
  const status = qs(q.status);
  const plan = qs(q.plan);
  const from = qs(q.from);
  const to = qs(q.to);
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 864e5);
  if (filter === 'active') { where.status = 'ACTIVE'; where.expiryDate = { gt: now }; }
  else if (filter === 'expiring') { where.status = 'ACTIVE'; where.expiryDate = { gt: now, lte: in7 }; }
  else if (filter === 'expired') { where.OR = [{ status: { in: ['EXPIRED', 'CANCELLED'] } }, { expiryDate: { lte: now } }]; }
  if (status) where.status = status;
  if (plan) where.plan = plan;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999`);
  }
  return where;
}

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

  /**
   * GET /admin/dashboard?from&to — KPIs + series diaria + breakdowns para el panel principal.
   * Sin from/to: últimos 30 días.
   */
  static async dashboard(req: AdminRequest, res: Response): Promise<void> {
    const now = new Date();
    const from = qs(req.query.from)
      ? new Date(`${qs(req.query.from)}T00:00:00`)
      : new Date(now.getTime() - 29 * 864e5);
    const to = qs(req.query.to) ? new Date(`${qs(req.query.to)}T23:59:59.999`) : now;
    const inRange = { gte: from, lte: to };

    const [
      totalUsers, active, pending, expired, cancelled,
      paidCount, pendingCount, failedCount, studies,
      revenueAll, paymentsInRange, usersInRange, subsByPlan, usersByStatus,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: 'PENDING_PAYMENT' } }),
      prisma.user.count({ where: { status: 'EXPIRED' } }),
      prisma.user.count({ where: { status: 'CANCELLED' } }),
      prisma.paymentOrder.count({ where: { status: 'PAID' } }),
      prisma.paymentOrder.count({ where: { status: 'PENDING' } }),
      prisma.paymentOrder.count({ where: { status: 'FAILED' } }),
      prisma.medicalStudy.count(),
      prisma.paymentOrder.groupBy({ by: ['currency'], where: { status: 'PAID' }, _sum: { amount: true } }),
      prisma.paymentOrder.findMany({
        where: { createdAt: inRange },
        select: { createdAt: true, amount: true, currency: true, status: true, gateway: true },
      }),
      prisma.user.findMany({ where: { createdAt: inRange }, select: { createdAt: true } }),
      prisma.subscription.groupBy({ by: ['plan'], _count: true }),
      prisma.user.groupBy({ by: ['status'], _count: true }),
    ]);

    // Serie diaria (revenue PAID + nº de pagos + nº de altas) sobre el rango.
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const days: Record<string, { date: string; revenue: number; payments: number; newUsers: number }> = {};
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 864e5)) {
      days[dayKey(d)] = { date: dayKey(d), revenue: 0, payments: 0, newUsers: 0 };
    }
    for (const p of paymentsInRange) {
      const k = dayKey(p.createdAt);
      if (!days[k]) continue;
      days[k].payments++;
      if (p.status === 'PAID') days[k].revenue += p.amount;
    }
    for (const u of usersInRange) {
      const k = dayKey(u.createdAt);
      if (days[k]) days[k].newUsers++;
    }

    const byStatus: Record<string, { count: number; sum: number }> = {};
    const byGateway: Record<string, { count: number; sum: number }> = {};
    for (const p of paymentsInRange) {
      (byStatus[p.status] ||= { count: 0, sum: 0 }).count++;
      if (p.status === 'PAID') byStatus[p.status].sum += p.amount;
      (byGateway[p.gateway] ||= { count: 0, sum: 0 }).count++;
      if (p.status === 'PAID') byGateway[p.gateway].sum += p.amount;
    }

    const revenueInRange = paymentsInRange.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);

    res.json({
      range: { from: dayKey(from), to: dayKey(to) },
      kpis: {
        totalUsers, active, pending, expired, cancelled,
        paidCount, pendingCount, failedCount, studies,
        revenuePYG: revenueAll.find((r) => r.currency === 'PYG')?._sum.amount || 0,
        revenueBRL: revenueAll.find((r) => r.currency === 'BRL')?._sum.amount || 0,
        newUsersInRange: usersInRange.length,
        paymentsInRange: paymentsInRange.length,
        paidInRange: paymentsInRange.filter((p) => p.status === 'PAID').length,
        revenueInRange,
      },
      series: Object.values(days),
      byStatus: Object.entries(byStatus).map(([status, v]) => ({ status, ...v })),
      byGateway: Object.entries(byGateway).map(([gateway, v]) => ({ gateway, ...v })),
      subsByPlan: subsByPlan.map((s) => ({ plan: s.plan, count: (s as any)._count })),
      usersByStatus: usersByStatus.map((u) => ({ status: u.status, count: (u as any)._count })),
    });
  }

  /**
   * GET /admin/movements?from&to&type&status&page — feed unificado: pagos + altas + suscripciones.
   * type: PAYMENT | SIGNUP | SUBSCRIPTION (vacío = todos).
   */
  static async movements(req: AdminRequest, res: Response): Promise<void> {
    const page = Math.max(1, parseInt(qs(req.query.page) || '1', 10));
    const type = qs(req.query.type).toUpperCase();
    const status = qs(req.query.status);
    const from = qs(req.query.from) ? new Date(`${qs(req.query.from)}T00:00:00`) : undefined;
    const to = qs(req.query.to) ? new Date(`${qs(req.query.to)}T23:59:59.999`) : undefined;
    const baseWhere = (): any => {
      const w: any = {};
      if (from || to) w.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
      if (status) w.status = status;
      return w;
    };

    const items: any[] = [];

    if (!type || type === 'PAYMENT') {
      const rows = await prisma.paymentOrder.findMany({
        where: baseWhere(),
        orderBy: { createdAt: 'desc' }, take: 400,
        include: { user: { select: { fullName: true, phoneNumber: true } } },
      });
      for (const p of rows) items.push({
        type: 'PAYMENT', at: p.createdAt, title: p.user?.fullName || p.user?.phoneNumber || '—',
        subtitle: `${p.gateway} · ${p.paymentMethod}`, status: p.status,
        amount: p.amount, currency: p.currency, ref: p.referenceCode,
      });
    }
    if (!type || type === 'SIGNUP') {
      const rows = await prisma.user.findMany({
        where: baseWhere(),
        orderBy: { createdAt: 'desc' }, take: 400,
        select: { id: true, fullName: true, phoneNumber: true, status: true, createdAt: true },
      });
      for (const u of rows) items.push({
        type: 'SIGNUP', at: u.createdAt, title: u.fullName || 'Sin nombre',
        subtitle: u.phoneNumber, status: u.status, userId: u.id,
      });
    }
    if (!type || type === 'SUBSCRIPTION') {
      const rows = await prisma.subscription.findMany({
        where: baseWhere(),
        orderBy: { createdAt: 'desc' }, take: 400,
        include: { user: { select: { id: true, fullName: true, phoneNumber: true } } },
      });
      for (const s of rows) items.push({
        type: 'SUBSCRIPTION', at: s.createdAt, title: s.user?.fullName || s.user?.phoneNumber || '—',
        subtitle: `${s.plan} · vence ${new Date(s.expiryDate).toLocaleDateString('es-PY')}`,
        status: s.status, amount: s.amount, currency: s.currency, userId: s.user?.id,
      });
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const total = items.length;
    const slice = items.slice((page - 1) * PAGE, page * PAGE);
    res.json({ total, page, pageSize: PAGE, rows: slice });
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
        medicationReminders: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!user) { res.status(404).json({ error: 'No encontrado' }); return; }
    res.json({ user });
  }

  static async deleteReminder(req: AdminRequest, res: Response): Promise<void> {
    await prisma.medicationReminder.deleteMany({ where: { id: req.params.rid, userId: req.params.id } });
    res.json({ ok: true });
  }

  // ---- Prompts de IA (editables, los usa el bot para responder consultas) ----
  static async listAiPrompts(_req: AdminRequest, res: Response): Promise<void> {
    res.json({ rows: await prisma.aiPrompt.findMany({ orderBy: { sortOrder: 'asc' } }) });
  }
  static async createAiPrompt(req: AdminRequest, res: Response): Promise<void> {
    const { name, scope, content, sortOrder, active } = req.body || {};
    if (!name || !content) { res.status(400).json({ error: 'name y content son obligatorios' }); return; }
    const s = ['GENERAL', 'PRE_REGISTRO', 'MIEMBRO_ACTIVO'].includes(scope) ? scope : 'GENERAL';
    const row = await prisma.aiPrompt.create({
      data: { name: String(name), scope: s, content: String(content), sortOrder: Number(sortOrder) || 0, active: active !== false },
    });
    AiPromptService.bust();
    res.json({ row });
  }
  static async updateAiPrompt(req: AdminRequest, res: Response): Promise<void> {
    const { name, scope, content, sortOrder, active } = req.body || {};
    const data: any = {};
    if (name !== undefined) data.name = String(name);
    if (scope !== undefined && ['GENERAL', 'PRE_REGISTRO', 'MIEMBRO_ACTIVO'].includes(scope)) data.scope = scope;
    if (content !== undefined) data.content = String(content);
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    if (active !== undefined) data.active = !!active;
    const row = await prisma.aiPrompt.update({ where: { id: req.params.id }, data });
    AiPromptService.bust();
    res.json({ row });
  }
  static async deleteAiPrompt(req: AdminRequest, res: Response): Promise<void> {
    await prisma.aiPrompt.delete({ where: { id: req.params.id } });
    AiPromptService.bust();
    res.json({ ok: true });
  }

  static async setUserStatus(req: AdminRequest, res: Response): Promise<void> {
    const { status, months } = req.body || {};
    const allowed = ['ACTIVE', 'PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'];
    if (!allowed.includes(status)) { res.status(400).json({ error: 'Estado invalido' }); return; }
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { status } });

    // Activar a mano SIN una suscripción vigente = el cron lo vuelve a bajar a EXPIRED al día
    // siguiente. Al activar, garantizamos una suscripción activa (por defecto +12 meses).
    if (status === 'ACTIVE') {
      const addMonths = Math.max(1, Math.min(60, Math.round(Number(months) || 12)));
      const latest = await prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
      const base = latest && latest.expiryDate > new Date() ? new Date(latest.expiryDate) : new Date();
      base.setMonth(base.getMonth() + addMonths);
      if (latest) {
        await prisma.subscription.update({
          where: { id: latest.id },
          data: { status: 'ACTIVE', expiryDate: base, finePending: false, fineAmount: 0, lastNotification: 'NONE' },
        });
      } else {
        await prisma.subscription.create({
          data: {
            userId: user.id, plan: addMonths >= 12 ? 'ANNUAL' : 'MONTHLY',
            country: 'PARAGUAY', currency: 'PYG', amount: 0, status: 'ACTIVE',
            expiryDate: base, lastNotification: 'NONE',
          },
        });
      }
    }
    res.json({ ok: true, status: user.status });
  }

  /** PATCH /admin/users/:id — editar datos del usuario (nombre, teléfono, CI, email, etc.). */
  static async updateUser(req: AdminRequest, res: Response): Promise<void> {
    const b = req.body || {};
    const data: any = {};
    const strFields = ['fullName', 'ciNumber', 'email', 'bloodType', 'dateOfBirth', 'birthPlace', 'sex', 'address'];
    for (const f of strFields) if (b[f] !== undefined) data[f] = b[f] === '' ? null : String(b[f]).trim();
    if (b.language && ['ES', 'GN'].includes(b.language)) data.language = b.language;

    if (b.phoneNumber !== undefined) {
      const phone = String(b.phoneNumber).replace(/[^0-9]/g, '');
      if (!/^\d{7,15}$/.test(phone)) { res.status(400).json({ error: 'Teléfono inválido (7-15 dígitos).' }); return; }
      const clash = await prisma.user.findFirst({ where: { phoneNumber: phone, NOT: { id: req.params.id } }, select: { id: true } });
      if (clash) { res.status(409).json({ error: 'Ya existe otro usuario con ese teléfono.' }); return; }
      data.phoneNumber = phone;
    }
    if (Object.keys(data).length === 0) { res.status(400).json({ error: 'Nada para actualizar.' }); return; }
    try {
      const user = await prisma.user.update({ where: { id: req.params.id }, data });
      res.json({ ok: true, user });
    } catch {
      res.status(404).json({ error: 'Usuario no encontrado.' });
    }
  }

  /** Desbloquea el PIN tras 5 intentos fallidos (sin pérdida de datos). */
  static async unlockPin(req: AdminRequest, res: Response): Promise<void> {
    try {
      await prisma.user.update({
        where: { id: req.params.id },
        data: { failedPinAttempts: 0, pinLockedUntil: null },
      });
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: 'Usuario no encontrado.' });
    }
  }

  /**
   * Resetea el PIN. Zero-knowledge: el PIN deriva la clave de la bóveda médica cifrada,
   * así que al resetearlo esa bóveda queda ilegible → se limpia y el usuario elige un PIN
   * nuevo en su próximo acceso (por WhatsApp o web). La ficha pública y los estudios subidos
   * (archivos) no se pierden; solo el historial cifrado de consultas.
   */
  static async resetPin(req: AdminRequest, res: Response): Promise<void> {
    try {
      const user = await prisma.user.update({
        where: { id: req.params.id },
        data: {
          pinHash: null,
          encryptionSalt: null,
          encryptedMedicalBlob: null,
          webVaultInitialized: false,
          failedPinAttempts: 0,
          pinLockedUntil: null,
          onboardingState: 'RESET_PIN',
        },
      });
      res.json({ ok: true, note: 'El usuario deberá elegir un PIN nuevo por WhatsApp (escribiendo cualquier mensaje al bot); la bóveda cifrada se reinicia vacía.', userId: user.id });
    } catch {
      res.status(404).json({ error: 'Usuario no encontrado.' });
    }
  }

  /** Extiende (o crea) la suscripción del usuario N meses/días — para cortesías y soporte. */
  static async extendSubscription(req: AdminRequest, res: Response): Promise<void> {
    const days = Math.round(Number(req.body?.days) || 0);
    const months = Math.round(Number(req.body?.months) || 0);
    if (days <= 0 && months <= 0) { res.status(400).json({ error: 'Indicá días o meses a agregar.' }); return; }
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) { res.status(404).json({ error: 'Usuario no encontrado.' }); return; }

    const latest = await prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    const base = latest && latest.expiryDate > new Date() ? new Date(latest.expiryDate) : new Date();
    if (months > 0) base.setMonth(base.getMonth() + months);
    if (days > 0) base.setDate(base.getDate() + days);

    if (latest) {
      await prisma.subscription.update({
        where: { id: latest.id },
        data: { expiryDate: base, status: 'ACTIVE', finePending: false, fineAmount: 0, lastNotification: 'NONE' },
      });
    } else {
      await prisma.subscription.create({
        data: {
          userId: user.id, plan: months >= 12 ? 'ANNUAL' : 'MONTHLY',
          country: 'PARAGUAY', currency: 'PYG', amount: 0, status: 'ACTIVE', expiryDate: base, lastNotification: 'NONE',
        },
      });
    }
    await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    res.json({ ok: true, expiryDate: base });
  }

  /** DELETE /admin/users/:id — borra el usuario y todo lo asociado (cascade). Irreversible. */
  static async deleteUser(req: AdminRequest, res: Response): Promise<void> {
    try {
      await prisma.user.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: 'Usuario no encontrado.' });
    }
  }

  /** GET /admin/subscriptions — monitoreo de suscripciones. filtro: ?filter=active|expiring|expired|all */
  static async listSubscriptions(req: AdminRequest, res: Response): Promise<void> {
    const page = Math.max(1, parseInt(qs(req.query.page) || '1', 10));
    const where = subscriptionWhere(req.query as any);
    const now = new Date();
    const [total, rows, totals] = await Promise.all([
      prisma.subscription.count({ where }),
      prisma.subscription.findMany({
        where,
        orderBy: { expiryDate: 'asc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { user: { select: { id: true, fullName: true, phoneNumber: true, status: true } } },
      }),
      prisma.subscription.groupBy({ by: ['currency'], where, _sum: { amount: true }, _count: true }),
    ]);
    res.json({
      total, page, pageSize: PAGE,
      totals: totals.map((t) => ({ currency: t.currency, count: t._count, sum: t._sum.amount || 0 })),
      rows: rows.map((s) => ({
        id: s.id, plan: s.plan, status: s.status, currency: s.currency, amount: s.amount,
        startDate: s.startDate, expiryDate: s.expiryDate,
        daysLeft: Math.ceil((s.expiryDate.getTime() - now.getTime()) / 864e5),
        finePending: s.finePending, user: s.user,
      })),
    });
  }

  /** Export de suscripciones (mismos filtros) — CSV (Excel) o JSON (para imprimir). */
  static async exportSubscriptions(req: AdminRequest, res: Response): Promise<void> {
    const where = subscriptionWhere(req.query as any);
    const now = new Date();
    const rows = await prisma.subscription.findMany({
      where, orderBy: { expiryDate: 'asc' }, take: 5000,
      include: { user: { select: { fullName: true, phoneNumber: true } } },
    });
    const mapped = rows.map((s) => ({
      cliente: s.user?.fullName || '', telefono: s.user?.phoneNumber || '',
      plan: s.plan, estado: s.status, moneda: s.currency, monto: s.amount,
      inicio: new Date(s.startDate).toISOString().slice(0, 10),
      vence: new Date(s.expiryDate).toISOString().slice(0, 10),
      diasRestantes: Math.ceil((s.expiryDate.getTime() - now.getTime()) / 864e5),
      multa: s.finePending ? 'SI' : 'NO',
    }));
    if (qs(req.query.format) === 'json') {
      const totals = await prisma.subscription.groupBy({ by: ['currency'], where, _sum: { amount: true }, _count: true });
      res.json({ rows: mapped, totals: totals.map((t) => ({ currency: t.currency, count: t._count, sum: t._sum.amount || 0 })) });
      return;
    }
    const header = ['Cliente', 'Telefono', 'Plan', 'Estado', 'Moneda', 'Monto', 'Inicio', 'Vence', 'DiasRestantes', 'Multa'];
    const csv = '﻿' + [header.join(','), ...mapped.map((m) => Object.values(m).map(csvCell).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="suscripciones-biopass-${now.toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }

  static async listPayments(req: AdminRequest, res: Response): Promise<void> {
    const page = Math.max(1, parseInt(qs(req.query.page) || '1', 10));
    const where = paymentWhere(req.query as any);
    const [total, rows, totals] = await Promise.all([
      prisma.paymentOrder.count({ where }),
      prisma.paymentOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { user: { select: { fullName: true, phoneNumber: true } } },
      }),
      prisma.paymentOrder.groupBy({ by: ['currency'], where, _sum: { amount: true }, _count: true }),
    ]);
    res.json({
      total,
      page,
      pageSize: PAGE,
      rows,
      totals: totals.map((t) => ({ currency: t.currency, count: t._count, sum: t._sum.amount || 0 })),
    });
  }

  /** Exporta la lista de pagos (con los mismos filtros) a CSV (Excel) o JSON (para imprimir). */
  static async exportPayments(req: AdminRequest, res: Response): Promise<void> {
    const where = paymentWhere(req.query as any);
    const rows = await prisma.paymentOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { user: { select: { fullName: true, phoneNumber: true } } },
    });
    if (qs(req.query.format) === 'json') {
      const totals = await prisma.paymentOrder.groupBy({ by: ['currency'], where, _sum: { amount: true }, _count: true });
      res.json({
        rows: rows.map((p) => ({
          createdAt: p.createdAt, fullName: p.user?.fullName || '', phoneNumber: p.user?.phoneNumber || '',
          gateway: p.gateway, paymentMethod: p.paymentMethod, amount: p.amount, currency: p.currency,
          status: p.status, referenceCode: p.referenceCode,
        })),
        totals: totals.map((t) => ({ currency: t.currency, count: t._count, sum: t._sum.amount || 0 })),
      });
      return;
    }
    const header = ['Fecha', 'Cliente', 'Telefono', 'Gateway', 'Metodo', 'Monto', 'Moneda', 'Estado', 'Referencia'];
    const lines = rows.map((p) =>
      [
        new Date(p.createdAt).toISOString(),
        p.user?.fullName || '',
        p.user?.phoneNumber || '',
        p.gateway,
        p.paymentMethod,
        p.amount,
        p.currency,
        p.status,
        p.referenceCode,
      ]
        .map(csvCell)
        .join(',')
    );
    const csv = '﻿' + [header.join(','), ...lines].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pagos-biopass-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
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
