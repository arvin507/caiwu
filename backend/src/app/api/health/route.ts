import { NextResponse } from 'next/server'

// GET /api/health —— 健康检查，部署/联调时先打这个确认服务活着
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'caiwu-backend',
    time: new Date().toISOString(),
  })
}
