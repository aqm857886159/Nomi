// 「帮 Nomi 变好」首次询问卡（样张 A，用户 09-15 已拍板）。
//
// 只在**第一次打开 Agent 面板的空态**里出现一次。为什么是这一刻而不是安装第一屏
// （用户拍板②，这里记下理由）：安装那一刻他还不知道 Nomi 是什么，一个不理解的同意
// 不是同意，只是一次点击。第一次打开 Agent 面板时他已经在用了，这时候问才有意义。
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
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { DecisionBar } from '../../../design'
import { getDesktopBridge } from '../../../desktop/bridge'
import { hasAskedAgentConsent, markAgentConsentAsked } from '../../onboarding/onboardingState'

export function V4ConsentCard({
  /** 实验室用：跳过 localStorage 判断，强制渲染。生产路径不传。 */
  forceVisible = false,
}: {
  forceVisible?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  // 初始值就读一次标记：渲染过一帧再消失会闪一下，那比不出现更糟。
  const [visible, setVisible] = React.useState(() => forceVisible || !hasAskedAgentConsent())

  // 普通函数就够：它的结果每次渲染都被 `onClick={() => answer(true)}` 包一层新箭头，
  // useCallback 的 memo 从来不生效，只是多一层噪音。
  const answer = (accepted: boolean): void => {
    // 两个钮**都**记「问过了」。记的是问过，不是同意——他点了「不用了」之后自己去设置里
    // 打开，也不该让这张卡再冒出来（判据住在 onboardingState.ts，那儿写了理由）。
    markAgentConsentAsked()
    setVisible(false)
    if (!accepted) return
    // 同意与否的真相源是主进程的同意合同，不是这张卡。这里只是它的第二个写入口。
    void getDesktopBridge()?.settings?.telemetry?.set({ enabled: true }).catch(() => undefined)
  }

  if (!visible) return <></>

  return (
    <div
      data-v4-block="consent"
      className="mt-3 rounded-nomi border border-nomi-accent bg-nomi-paper p-3.5 text-left"
    >
      <p className="text-body-sm font-medium text-nomi-ink">{t('agentPanelV4.consent.title')}</p>
      <p className="mt-1.5 text-caption leading-relaxed text-nomi-ink-60">{t('agentPanelV4.consent.collects')}</p>
      <p className="mt-0.5 text-caption leading-relaxed text-nomi-ink-60">{t('agentPanelV4.consent.excludes')}</p>
      {/* 决定栏：拒绝在左、同意在最右（UI-R01）；两颗同尺寸，只有 variant 不同。
          12px 而不是 micro(11px)：体感门岗 `check:feel` 的可读下限就是 12px，
          而这行是首次询问卡上唯一解释「以后去哪儿关」的话——它比按钮更需要被读到。 */}
      <DecisionBar
        className="mt-3"
        size="md"
        leading={<span className="text-caption text-nomi-ink-40">{t('agentPanelV4.consent.settingsHint')}</span>}
        cancelLabel={t('agentPanelV4.consent.decline')}
        onCancel={() => answer(false)}
        cancelProps={{ 'data-v4-consent-decline': '' }}
        primaryLabel={t('agentPanelV4.consent.accept')}
        onPrimary={() => answer(true)}
        primaryProps={{ 'data-v4-consent-accept': '' }}
      />
    </div>
  )
}
