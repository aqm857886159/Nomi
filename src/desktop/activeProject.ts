let activeProjectId = ''
let activeProjectIdInitialized = false

// 与 projectPersistenceService.LAST_ACTIVE_PROJECT_KEY 同一把钥匙：每次项目 hydrate/保存
// 都会写入当前项目 id，是「当前打开的是哪个项目」的权威、同步、跨刷新可读的真相源。
const LAST_ACTIVE_PROJECT_KEY = 'nomi-workbench-last-active-project-v1'
export const DESKTOP_ACTIVE_PROJECT_CHANGED_EVENT = 'nomi-desktop-active-project-changed'

export function setDesktopActiveProjectId(projectId: string | null | undefined): void {
  const nextProjectId = typeof projectId === 'string' ? projectId.trim() : ''
  const changed = !activeProjectIdInitialized || activeProjectId !== nextProjectId
  activeProjectIdInitialized = true
  if (!changed) return
  activeProjectId = nextProjectId
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent(DESKTOP_ACTIVE_PROJECT_CHANGED_EVENT, { detail: { projectId: nextProjectId } }))
  }
}

function readPersistedActiveProjectId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return (window.localStorage.getItem(LAST_ACTIVE_PROJECT_KEY) || '').trim()
  } catch {
    return ''
  }
}

// 取当前活动项目 id。
//
// setter 首次运行前，内存里的 activeProjectId 还没有完成 React 同步；这一小段启动窗口
// 回退到持久化值，避免上传/生成拿不到 projectId。setter 一旦显式写入（包括清空），就
// 必须以该内存状态为准，不能把上一个项目从 localStorage 重新“复活”，否则素材会串台。
// projectId 缺失会导致生成图保留厂商临时 URL（隔天过期消失）、上传图退回 base64。
// 所以只在初始化完成前回退到持久化的 last-active id，堵住这个静默丢图的窗口。
export function getDesktopActiveProjectId(): string {
  return activeProjectIdInitialized ? activeProjectId : readPersistedActiveProjectId()
}

export function subscribeDesktopActiveProjectIdChange(listener: (projectId: string) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') {
    return () => undefined
  }
  const handler = (event: Event): void => {
    const projectId =
      event instanceof CustomEvent && typeof event.detail?.projectId === 'string'
        ? event.detail.projectId
        : getDesktopActiveProjectId()
    listener(projectId)
  }
  const storageHandler = (event: StorageEvent): void => {
    if (event.key && event.key !== LAST_ACTIVE_PROJECT_KEY) return
    if (activeProjectIdInitialized) return
    listener(readPersistedActiveProjectId())
  }
  window.addEventListener(DESKTOP_ACTIVE_PROJECT_CHANGED_EVENT, handler)
  window.addEventListener('storage', storageHandler)
  return () => {
    window.removeEventListener(DESKTOP_ACTIVE_PROJECT_CHANGED_EVENT, handler)
    window.removeEventListener('storage', storageHandler)
  }
}
