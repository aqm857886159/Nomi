import React from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 快捷键面板。原来是 `TimelinePanel.tsx` 里 `shortcutsOpen ? … : null` 的一段内联 JSX；
 * 抽成组件是为了让**设计实验室**能单独取景它（`screens/editing/`），而不是为了复用——
 * 它今天只有一个调用者，抽出去的同时那段内联 JSX 已删（P1：不留并行版）。
 *
 * DOM 结构、`role="dialog"` / `aria-label`、条目顺序与文案一字未改：
 * 走查 `tests/ux/editing-real-user-pass.walk.mjs` 第 8 步按 `getByRole('dialog', { name: '快捷键' })`
 * 和面板上写的键位逐条对账，改这里的措辞会当场把那条走查判红。
 */
export function TimelineShortcutsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[color-mix(in_oklch,var(--nomi-ink)_18%,transparent)]" onClick={onClose}>
      <div className="w-80 rounded-[var(--nomi-radius-lg)] border border-[var(--workbench-border)] bg-[var(--nomi-paper)] p-4 shadow-[var(--nomi-shadow-lg)]" role="dialog" aria-label={t('timelineEditor.shortcuts.title')} onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><strong className="text-body-sm">{t('timelineEditor.shortcuts.title')}</strong><button type="button" onClick={onClose}>×</button></div>
        <div className="grid grid-cols-[1fr_auto] gap-y-2 text-micro">
          <span>{t('timelineEditor.context.split')}</span><kbd>{t('timelineEditor.shortcuts.splitKey')}</kbd><span>{t('timelineEditor.context.duplicate')}</span><kbd>{t('timelineEditor.shortcuts.duplicateKey')}</kbd><span>{t('timelineEditor.context.delete')}</span><kbd>{t('timelineEditor.shortcuts.deleteKey')}</kbd><span>{t('timelineEditor.context.rippleDelete')}</span><kbd>{t('timelineEditor.shortcuts.rippleKey')}</kbd><span>{t('timelineEditor.context.deleteLeft')}</span><kbd>{t('timelineEditor.shortcuts.leftKey')}</kbd><span>{t('timelineEditor.context.deleteRight')}</span><kbd>{t('timelineEditor.shortcuts.rightKey')}</kbd><span>{t('timelineEditor.undo')}</span><kbd>{t('timelineEditor.shortcuts.undoKey')}</kbd><span>{t('timelineEditor.redo')}</span><kbd>{t('timelineEditor.shortcuts.redoKey')}</kbd><span>{t('timelineEditor.shortcuts.toggleSnap')}</span><kbd>{t('timelineEditor.shortcuts.snapKey')}</kbd><span>{t('timelineEditor.shortcuts.zoom')}</span><kbd>{t('timelineEditor.shortcuts.zoomKey')}</kbd><span>{t('timelineEditor.shortcuts.toggleAssistant')}</span><kbd>{t('timelineEditor.shortcuts.assistantKey')}</kbd>
        </div>
      </div>
    </div>
  )
}
