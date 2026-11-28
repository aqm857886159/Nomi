// 「帮 Nomi 变好」首次询问卡（样张 A，用户 09-15 已拍板；UX-A4 延后至首次生成或首轮对话后出现）。
//
// 只在**创作者完成首次生成或首轮 Agent 对话后的空态**里出现一次（`canAskFirstAgentConsent()`）。
// 新建第一个空白项目一字未写时不弹，避免首屏注意力被二选一打断；完成首个创作里程碑后再问，
// 用户已理解 Nomi 在做什么，回答更有意义且只问一次。
//
// 卡面形状的三条硬约束（用户原话：「整个设计要考虑体验、简化流程、让用户理解我们不是
// 做坏事只是为了真实优化产品」）：
//   ① **两个钮同等大小**。把「不用了」做成一行灰色小字是暗模式（dark pattern）——
//      那不是在问他，是在让他难以拒绝。
//   ② **不做「稍后再说」**。它等于没问，还保证会再弹一次。
//   ③ **不放隐私政策长文链接**。用户要的是「你到底收什么」，一句一行的「收 ✓ / 不收 ✗」
//      比一份他不会读的条款有用得多。长文放设置页。
//
// 「让他理解我们不是做坏事」这件事不是靠一句承诺做到的，是靠那两行清单**看得见**。
// 所以这张卡上没有「我们非常重视您的隐私」这类句子，只有事实。
//
// 2026-10-16：告知范围升到 v2（多了「界面流畅度分档数字」）。已同意旧范围的用户在**同一个位置、同一个组件**
// 里再被问一次（`scope` 形态，只讲多了什么）；答之前扩展字段不发（主进程按范围版本拦，见
// electron/telemetry/telemetryEvents.ts 的 TELEMETRY_EVENT_MIN_SCOPE）。「保持原样」不写任何东西：
// 原范围的统计照旧，扩展字段继续不发。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { DecisionBar } from '../../../design'
import { getDesktopBridge } from '../../../desktop/bridge'
import {
  canAskFirstAgentConsent,
  hasAskedAgentConsent,
  hasAskedAgentConsentScope,
  markAgentConsentAsked,
  markAgentConsentScopeAsked,
  ONBOARDING_STATE_SYNC_EVENT,
} from '../../onboarding/onboardingState'

type ConsentMode = 'first' | 'scope'

export function V4ConsentCard({
  /** 实验室用：跳过 localStorage / 主进程判断，强制渲染指定形态。生产路径不传。 */
  force,
}: {
  force?: ConsentMode
}): JSX.Element {
  const { t } = useTranslation()
  // 初始值就读一次准入谓词：渲染过一帧再消失会闪一下，那比不出现更糟。
  const [mode, setMode] = React.useState<ConsentMode | null>(() => force ?? (canAskFirstAgentConsent() ? 'first' : null))

  // 未问过且尚未达成里程碑时监听状态变更：画布完成首图生成或首轮对话完成后，空态里立即现身且只问一次。
  React.useEffect(() => {
    if (force || mode !== null || hasAskedAgentConsent()) return
    const sync = (): void => {
      if (canAskFirstAgentConsent()) setMode('first')
    }
    sync()
    window.addEventListener(ONBOARDING_STATE_SYNC_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ONBOARDING_STATE_SYNC_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [force, mode])

  // 首次问过之后，才轮到「范围升级再确认」：开着遥测、但同意的还是旧范围、且这台机器没问过。
  React.useEffect(() => {
    if (force || mode !== null || !hasAskedAgentConsent() || hasAskedAgentConsentScope()) return
    let active = true
    void getDesktopBridge()?.settings?.telemetry?.get().then((view) => {
      if (active && view.enabled && view.scopeVersion < 2) setMode('scope')
    }).catch(() => undefined)
    return () => { active = false }
  }, [force, mode])

  // 普通函数就够：它的结果每次渲染都被 `onClick={() => answer(true)}` 包一层新箭头，
  // useCallback 的 memo 从来不生效，只是多一层噪音。
  const answer = (accepted: boolean): void => {
    // 两个钮**都**记「问过了」。记的是问过，不是同意——他点了「不用了」之后自己去设置里
    // 打开，也不该让这张卡再冒出来（判据住在 onboardingState.ts，那儿写了理由）。
    if (mode === 'scope') markAgentConsentScopeAsked()
    else markAgentConsentAsked()
    setMode(null)
    if (!accepted) return
    // 同意与否的真相源是主进程的同意合同，不是这张卡。这里只是它的第二个写入口；
    // 写入 enabled:true 即把主进程记下的告知范围版本升到当前版。
    void getDesktopBridge()?.settings?.telemetry?.set({ enabled: true }).catch(() => undefined)
  }

  if (!mode) return <></>
  // 键名写成字面量（不拼接）：check:i18n 要静态认得出每个键。
  const text = mode === 'scope'
    ? { title: t('agentPanelV4.consent.scopeTitle'), collects: t('agentPanelV4.consent.scopeCollects'), excludes: t('agentPanelV4.consent.scopeExcludes'), accept: t('agentPanelV4.consent.scopeAccept'), decline: t('agentPanelV4.consent.scopeDecline') }
    : { title: t('agentPanelV4.consent.title'), collects: t('agentPanelV4.consent.collects'), excludes: t('agentPanelV4.consent.excludes'), accept: t('agentPanelV4.consent.accept'), decline: t('agentPanelV4.consent.decline') }

  return (
    <div
      data-v4-block="consent"
      data-v4-consent-mode={mode}
      className="mt-3 rounded-nomi border border-nomi-line bg-nomi-paper p-3.5 text-left"
    >
      <p className="text-body-sm font-medium text-nomi-ink">{text.title}</p>
      <p className="mt-1.5 text-caption leading-relaxed text-nomi-ink-60">{text.collects}</p>
      <p className="mt-0.5 text-caption leading-relaxed text-nomi-ink-60">{text.excludes}</p>
      {/* 决定栏：拒绝在左、同意在最右（UI-R01）；两颗同尺寸，只有 variant 不同。
          12px 而不是 micro(11px)：体感门岗 `check:feel` 的可读下限就是 12px，
          而这行是首次询问卡上唯一解释「以后去哪儿关」的话——它比按钮更需要被读到。 */}
      <DecisionBar
        className="mt-3"
        size="md"
        leading={<span className="text-caption text-nomi-ink-40">{t('agentPanelV4.consent.settingsHint')}</span>}
        cancelLabel={text.decline}
        onCancel={() => answer(false)}
        cancelProps={{ 'data-v4-consent-decline': '' }}
        primaryLabel={text.accept}
        onPrimary={() => answer(true)}
        primaryProps={{ 'data-v4-consent-accept': '' }}
      />
    </div>
  )
}
