import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// 首次启动创建超级管理员：admin / 123456
// 后续登录后可在「修改密码」页自行修改
async function main() {
  const username = 'admin'
  const exists = await prisma.user.findUnique({ where: { username } })
  if (exists) {
    console.log('超级管理员已存在，跳过 seed')
    return
  }
  await prisma.user.create({
    data: {
      username: 'admin',
      name: '超级管理员',
      passwordHash: await bcrypt.hash('123456', 10),
      role: 'admin',
    },
  })
  console.log('已创建初始超级管理员：admin / 123456')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
