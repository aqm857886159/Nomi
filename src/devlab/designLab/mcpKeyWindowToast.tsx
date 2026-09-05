import React from 'react'
import i18n from '../../i18n'
import { toast } from '../../ui/toast'

/** Experimental lab registration for the host-config repair notice. */
export function McpKeyWindowToastState(): JSX.Element {
  React.useEffect(() => {
    toast(i18n.t('studio.hostConfigRepaired'), 'info')
  }, [])
  return (
    <div
      data-design-lab-shot="mcp-key-window-host-config-repaired"
      style={{ width: 720, minHeight: 420, padding: 32, background: 'var(--nomi-paper)', color: 'var(--nomi-ink)', font: '14px/1.5 system-ui' }}
    >
      <strong>实验室状态 · 宿主配置修复提示</strong>
      <p style={{ color: 'var(--nomi-ink-60)' }}>启动时发现 Claude Code 的 Nomi 接入配置需要修复。</p>
    </div>
  )
}
