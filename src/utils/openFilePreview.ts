/**
 * 带鉴权的文件预览工具。
 *
 * 为什么不用 <a href> 直接跳转？
 * 浏览器对 <a href> / <img src> 这类「导航/资源」请求的跳转，
 * 不会自动带上 Authorization 头。而后端凡是有鉴权的预览接口
 * （如报销单 /api/reimbursements/:id/file）缺 token 就会返回 401「未登录」。
 *
 * 这里改用 fetch 显式带上 Bearer token 下载为 blob，再用
 * URL.createObjectURL 在新标签页打开预览——既满足鉴权，又不把
 * token 暴露到 URL 里。
 */
export async function openFilePreview(url: string, token: string | null): Promise<void> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) {
    let msg = '预览失败'
    try {
      const j = (await res.json()) as { error?: string }
      msg = j.error || msg
    } catch {
      // 非 JSON 响应（如网关错误），保留默认文案
    }
    throw new Error(msg)
  }
  const blob = await res.blob()
  // 给文件起个名字，避免新标签页标题显示为「blob:」一长串
  const objectUrl = URL.createObjectURL(blob)
  const win = window.open(objectUrl, '_blank', 'noopener,noreferrer')
  // 兜底：个别浏览器 window.open 被拦截时，退化为本页下载
  if (!win) {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = ''
    a.click()
  }
  // 1 分钟后释放内存（足够新标签页完成加载）
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}
