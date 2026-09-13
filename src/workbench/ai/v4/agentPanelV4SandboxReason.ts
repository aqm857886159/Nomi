// Agent 面板 v4 · 「命令沙箱没起来」那一行微字的**文案取处**（纯函数，不认识 React）。
//
// 为什么需要这一行：沙箱没起来时，用户看到的全部症状是「每条命令都在问我」——
// 它和「Nomi 今天变啰嗦了」在界面上长得一模一样，没有任何线索指向真正的原因
// （`electron/shared/agentLane/laneContracts.ts` 的 `sandboxInactive` 字段头部有同一段理由）。
//
// 为什么映射住在这里而不是组件里：`vitest` 跑在 node 环境，没有 DOM，渲染断言写不了；
// 把「原因码 → 哪句话」这件唯一会出错的事做成纯函数，两种原因就都能被测住
// （`agentPanelV4SandboxReason.test.ts`）。组件那边只剩「把这句话印出来」。
import type { LaneSandboxInactiveCode } from '../../../../electron/shared/agentLane/laneContracts'

/**
 * 原因码 → i18n key。**Record 而不是 switch**：上游哪天加了第三种原因码，
 * TypeScript 当场在这里红，而不是让界面悄悄印出一个空串。
 */
export const V4_SANDBOX_INACTIVE_REASON_KEY: Readonly<Record<LaneSandboxInactiveCode, string>> = {
  'unsupported-platform': 'agentPanelV4.sandboxInactiveUnsupported',
  'init-failed': 'agentPanelV4.sandboxInactiveInitFailed',
}

/**
 * 那一行微字的完整文案。`translate` 就是 `useTranslation()` 的 `t`——本模块不 import i18n，
 * 是为了让测试不必起一整套 i18next 就能断言「两种原因各自选了哪一句」。
 */
export function v4SandboxNoticeText(
  code: LaneSandboxInactiveCode,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  return translate('agentPanelV4.sandboxInactive', { reason: translate(V4_SANDBOX_INACTIVE_REASON_KEY[code]) })
}
