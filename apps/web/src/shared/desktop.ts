type NomiDesktop = {
  isDesktop: boolean
  apiBase: string
  showNotification: (title: string, body: string) => Promise<void>
  onFileDrop: (callback: (paths: string[]) => void) => void
  onOpenNomiFile: (callback: (filePath: string) => void) => void
  readLocalFile: (filePath: string) => Promise<{ name: string; size: number; dataUrl: string }>
  setLoginItem: (enabled: boolean) => Promise<void>
  getLoginItem: () => Promise<boolean>
  getVersion: () => Promise<string>
  onUpdateAvailable: (callback: (info: unknown) => void) => void
  onUpdateReady: (callback: () => void) => void
  installUpdate: () => Promise<void>
}

function getDesktopApi(): NomiDesktop | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { __nomiDesktop__?: NomiDesktop }
  return w.__nomiDesktop__ ?? null
}

export const desktop = getDesktopApi()

export const isDesktop = desktop?.isDesktop === true

export function showDesktopNotification(title: string, body: string): void {
  if (desktop) {
    desktop.showNotification(title, body).catch(() => {})
    return
  }
  // 浏览器模式 fallback
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body })
  }
}

export function onDesktopFileDrop(callback: (paths: string[]) => void): void {
  desktop?.onFileDrop(callback)
}

export function onDesktopOpenNomiFile(callback: (filePath: string) => void): void {
  desktop?.onOpenNomiFile(callback)
}

export async function readDesktopLocalFile(
  filePath: string,
): Promise<{ name: string; size: number; dataUrl: string } | null> {
  if (!desktop) return null
  return desktop.readLocalFile(filePath)
}

export async function getDesktopVersion(): Promise<string | null> {
  if (!desktop) return null
  return desktop.getVersion()
}

export async function getDesktopLoginItem(): Promise<boolean> {
  if (!desktop) return false
  return desktop.getLoginItem()
}

export async function setDesktopLoginItem(enabled: boolean): Promise<void> {
  if (!desktop) return
  return desktop.setLoginItem(enabled)
}

export function onDesktopUpdateAvailable(callback: (info: unknown) => void): void {
  desktop?.onUpdateAvailable(callback)
}

export function onDesktopUpdateReady(callback: () => void): void {
  desktop?.onUpdateReady(callback)
}

export async function installDesktopUpdate(): Promise<void> {
  if (!desktop) return
  return desktop.installUpdate()
}
