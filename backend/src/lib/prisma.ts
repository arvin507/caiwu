import { PrismaClient } from '@prisma/client'

// 单例模式：Next.js 开发模式下会频繁热重载，
// 如果每次都 new PrismaClient()，连接数会暴涨直到耗尽。
// 用 globalThis 缓存一份，全局复用。
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
