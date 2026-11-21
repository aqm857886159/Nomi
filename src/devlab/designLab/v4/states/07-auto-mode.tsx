// 设计实验室 · Agent 面板 v4 · 「全自动」档（切档二次确认 + 常驻提醒）。
//
// 这个文件原来叫 `07-spend-params.tsx`，还装着 2026-09-10 那张付费卡 v2（整件画布生成框进介入槽、逐参数 chip、翻页）。
// D2 第③步（2026-10-24）那张卡随旧卡一起删了：付费卡现在是指向元素 + 一行只读摘要 + 「生成」，住自己的屏 `spend-card`
// （SpendCardQ1 板，`src/devlab/designLab/spendCard/`）。这里只剩跟它同一份设计文档出来的「全自动」那两样。
import React, { type JSX } from 'react'
import { V4Intervention } from '../../../../workbench/ai/v4/AgentPanelV4Cards'
import { V4AutoModeBanner } from '../../../../workbench/ai/v4/AgentPanelV4AutoMode'
import { AgentPanelV4Composer } from '../../../../workbench/ai/v4/AgentPanelV4Composer'
import { fixedEditorOwner } from '../../../../workbench/common/useNomiRichTextEditor'
import { useV4Labels } from '../../../../workbench/ai/v4/agentPanelV4Labels'
import { Piece, useV4Fixtures, V4_LAB_SLOT_HANDLERS } from '../agentPanelV4LabKit'
import type { LabState } from '../../labScreen'

const SOURCE = '2026-09-10-spend-card-node-params-and-full-auto.md'

/** 切到「全自动」的二次确认。**不是新组件**：它就是介入槽的可撤销档（换档本身可撤销）。 */
function AutoModeConfirmCard(): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  return (
    <Piece>
      <V4Intervention
        {...V4_LAB_SLOT_HANDLERS}
        data={{
          kind: 'approval-reversible',
          // 2026-09-10 用户拍板：标题左边那个对勾删掉。标题是一句问句，前面顶着 ✓ 读起来像「已经切好了」。
          hideIcon: true,
          title: fx.t('agentPanelV4.autoModeConfirmTitle'),
          summary: fx.t('agentPanelV4.autoModeConfirmBody'),
          confirmLabel: fx.t('agentPanelV4.autoModeConfirmOk'),
        }}
        labels={{ ...labels.intervention, reject: fx.t('agentPanelV4.autoModeConfirmCancel') }}
      />
    </Piece>
  )
}

/** 开启后的常驻提醒：一条 h-6 微字横条，压在 composer 上沿——它在的地方就是你打字的地方。 */
function AutoModeReminderCell(): JSX.Element {
  const fx = useV4Fixtures()
  const [tier, setTier] = React.useState<'direct' | 'request'>('direct')
  const [dismissed, setDismissed] = React.useState(false)
  return (
    <Piece>
      {tier === 'direct' && !dismissed ? (
        <V4AutoModeBanner
          label={fx.t('agentPanelV4.permission.direct')}
          note={fx.t('agentPanelV4.autoModeBannerNote')}
          revertLabel={fx.t('agentPanelV4.autoModeBannerRevert')}
          dismissLabel={fx.t('agentPanelV4.autoModeBannerDismiss')}
          onRevert={() => setTier('request')}
          onDismiss={() => setDismissed(true)}
        />
      ) : null}
      <AgentPanelV4Composer panelHeight={620} mode="idle" permission={tier} draft={fixedEditorOwner('')} draftReadOnly />
    </Piece>
  )
}

export const V4_AUTO_MODE_STATES: readonly LabState[] = [
  {
    id: 'v4-auto-mode-confirm',
    name: '全自动 · 切档二次确认（标题左侧对勾已删）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:191',
    coverage: 'component-only',
    render: () => <AutoModeConfirmCard />,
  },
  {
    id: 'v4-auto-mode-confirm-dark',
    name: '全自动 · 切档二次确认（暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:191',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <AutoModeConfirmCard />,
  },
  {
    id: 'v4-auto-mode-reminder',
    name: '全自动 · 常驻提醒（一点回「自动改」，右端 × 可叉掉）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4AutoMode.tsx:36',
    coverage: 'component-only',
    render: () => <AutoModeReminderCell />,
  },
  {
    id: 'v4-auto-mode-reminder-dark',
    name: '全自动 · 常驻提醒（暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4AutoMode.tsx:36',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <AutoModeReminderCell />,
  },
]
