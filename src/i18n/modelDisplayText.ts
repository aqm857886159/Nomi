import i18n from './index'
import { enModelDisplayText } from './locales/modelDisplayText'

export function translateModelDisplayText(value: string): string {
  const language = i18n.resolvedLanguage || i18n.language
  return language.startsWith('en') ? (enModelDisplayText[value] ?? value) : value
}
