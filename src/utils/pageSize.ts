/** 列表页每页条数：可供选择的档位 */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const STORAGE_KEY = 'app:pageSize'

/** 读取用户上次选择的每页条数（默认 10），非法/不存在时回退 10 */
export function getPageSize(): number {
  if (typeof window === 'undefined') return 10
  const v = Number(localStorage.getItem(STORAGE_KEY))
  return (PAGE_SIZE_OPTIONS as number[]).includes(v) ? v : 10
}

/** 持久化用户选择的每页条数，跨页面生效 */
export function setPageSize(size: number): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, String(size))
}
