import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export async function connectDB() {
  try {
    await prisma.$connect();
    console.log('✅ PostgreSQL Database connected successfully via Prisma');
    return true;
  } catch (err: any) {
    console.warn('⚠️ PostgreSQL connection failed, running in fallback mode or waiting for database:', err?.message || err);
    return false;
  }
}
