import 'i18next'
import type { zhCN } from './resources'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: typeof zhCN
  }
}
