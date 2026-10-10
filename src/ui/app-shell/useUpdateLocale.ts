import { useTranslation } from 'react-i18next'
import type { UpdateLocale } from '../../../electron/shared/updateReminder'

export function useUpdateLocale(): UpdateLocale {
  const { i18n } = useTranslation()
  return i18n.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
