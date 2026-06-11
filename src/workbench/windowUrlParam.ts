/**
 * 读窗口 URL 参数——同时兼容两种路由形态（唯一实现，别再各自手写）：
 * - dev(vite http):  http://…/?projectId=x          → search 段
 * - prod(file://):   file://…/index.html?step=g#/studio?projectId=x → hash 段
 *
 * 只读 search 段的版本在打包版里拿不到 projectId,曾导致 agent 会话桶
 * 全部落 `local`(跨项目串台)且事件轨迹静默不落盘。
 */
export function urlParamFromHref(href: string, name: string): string {
  try {
    const url = new URL(href)
    const direct = url.searchParams.get(name)
    if (direct && direct.trim()) return direct.trim()
    const hashSearch = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?')) : ''
    const value = hashSearch ? new URLSearchParams(hashSearch).get(name) : ''
    return value ? value.trim() : ''
  } catch {
    return ''
  }
}

export function readWindowUrlParam(name: string): string {
  if (typeof window === 'undefined') return ''
  return urlParamFromHref(window.location.href, name)
}
