/**
 * 设置 · 通用 · 项目级常驻 Agent 开关（发布闸）。
 *
 * 为什么在这里：常驻 Agent 宿主是一项工作区交互能力，和同页的「画布滚轮」「全局截图热键」一样属于
 * 「App 怎么陪你干活」的偏好，故归位到「通用」tab，不新开常驻面（§1.5 归位）。
 *
 * 为什么默认关：它的交互对齐 epic（#194）未完成前，整套常驻 UI 摆到用户面前会是个半成品面板。
 * 这是**发布闸**——开着才渲染。开关本身走共享偏好 [[agentHostPreference]]（localStorage + 订阅），
 * 一改当场生效、不用重开项目。控件样式沿用同页 [[CanvasGestureSection]]/自动另存开关，不另发明一套（P4）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { DesignSwitch } from '../../design'
import { setAgentHostEnabled, useAgentHostEnabled } from '../../utils/agentHostPreference'

export function AgentHostSection(): JSX.Element {
  const { t } = useTranslation()
  const enabled = useAgentHostEnabled()

  return (
    <div className="mt-5 border-t border-nomi-line pt-4" data-settings-section="agent-host">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-body-sm text-nomi-ink">{t('settings.general.agentHost')}</span>
        <DesignSwitch
          checked={enabled}
          onChange={(event) => setAgentHostEnabled(event.currentTarget.checked)}
          aria-label={t('settings.general.agentHost')}
          data-settings-agent-host-toggle
        />
      </div>
      <div className="text-caption leading-relaxed text-nomi-ink-40">{t('settings.general.agentHostHint')}</div>
    </div>
  )
}
