// 专用付费确认卡上「模型」那一行（供应商 · 模型）的唯一写法；按 intent 查表的几张专用卡共用（spendCardByIntent.ts）。
//
// 原来住在凭据验证的确认卡里。那张卡随 D-1117-delete-verification 删了（保存 key 不再发任何验证请求，
// 主进程也不再带 `intent: 'credential-probe'` 来问），只剩这一行写法还有人用，就搬到自己的文件。
import i18n from '../../i18n'

export type SpendCardModelPayload = {
  /** 卡上显示的供应商名。 */
  vendor?: string
  /** 这次调用打到哪个模型上。 */
  modelKey?: string
}

/** 卡上「模型」那一行怎么写（供应商 · 模型），各张专用卡同一份写法。 */
export function spendModelLine(vendor: string | undefined, modelKey: string | undefined): string {
  return [vendor, modelKey].filter(Boolean).join(' · ') || i18n.t('runtime.capability.defaultModel')
}
