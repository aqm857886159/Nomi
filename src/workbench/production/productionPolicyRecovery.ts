/**
 * 制作合同「供应商 / 模型未接入」的恢复入口。
 *
 * 2026-09-14 前这里带着「本次需要哪些供应商/模型」跳到 AI 策略页去勾白名单复选框；白名单已删
 * （已接入即放行，见 electron/productionRun/connectedModelScope.ts），「缺」现在只剩一种含义：
 * 那家还没接入 / 那个模型没 key——修法在「模型」tab 接上它，所以深链直接落到那里。
 */
export type ProductionPolicySettingsTarget = { tab: 'models' }

export function buildProductionPolicySettingsTarget(): ProductionPolicySettingsTarget {
  return { tab: 'models' }
}

export function isProductionPolicyError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /productionpolicyincomplete|制作合同暂不能批准|production contract policy|production approval requires.*(?:budget|provider|model)/i.test(message)
}
