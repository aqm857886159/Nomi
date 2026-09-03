import { toast } from '../ui/toast'

// 普通告知 toast(无撤销动作)——用于「到上限」等一次性提示。区别于 showUndoToast(那个带点击撤销)。
export function showInfoToast(message: string, id?: string): void {
  toast(message, 'info', id)
}

/** Stable identity for one provider-recovery transition; repeated effects update one toast. */
export function providerSwitchToastId(parts: readonly string[]): string {
  return ['provider-disconnected-switched', ...parts].map((part) => encodeURIComponent(part)).join(':')
}
