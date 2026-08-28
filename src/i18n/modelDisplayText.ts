import i18n from './index'
import { enModelDisplayText } from './locales/modelDisplayText'

export function translateModelDisplayText(value: string): string {
  const language = i18n.resolvedLanguage || i18n.language
  if (!language.startsWith('en')) return value
  return (enModelDisplayText[value] ?? value)
    .replace(/\s显存\b/g, ' VRAM')
    .replace('已连上 ComfyUI', 'Connected to ComfyUI')
    .replace('没连上（确认 ComfyUI 已在该地址启动）', 'Not connected (make sure ComfyUI is running at this address)')
}
