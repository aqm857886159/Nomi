/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 DesignModal、../../model/hotkeys（DIRECTOR_HOTKEYS / formatHotkey / DirectorHotkeyId）
 * [OUTPUT]: 对外提供 HelpDialog：四栏键位表（视口工具 / 视口操作 / 时间轴与轨道 / 视口漫游），键位全部从 model/hotkeys 单一来源实时格式化
 * [POS]: director/panels/dialogs 的帮助对话框（清单 §8 H2）：只呈现、不定义——改键位只改 hotkeys.ts，这里自动跟着变；
 *        鼠标手势与漫游键不是 DIRECTOR_HOTKEYS 里的绑定（Orbit / useFrame 直接读键），用固定 kbd 文本列出。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { DesignModal } from '../../../../../../design'
import { DIRECTOR_HOTKEYS, formatHotkey, type DirectorHotkeyId } from '../../model/hotkeys'

type HotkeyRow = { id: DirectorHotkeyId; labelKey: string }
type FixedRow = { keys: string; labelKey: string }

const TOOL_ROWS: HotkeyRow[] = [
  { id: 'select', labelKey: 'director.help.keys.select' },
  { id: 'translate', labelKey: 'director.help.keys.translate' },
  { id: 'rotate', labelKey: 'director.help.keys.rotate' },
  { id: 'scale', labelKey: 'director.help.keys.scale' },
  { id: 'drawPencil', labelKey: 'director.help.keys.drawPencil' },
  { id: 'waypoint', labelKey: 'director.help.keys.waypoint' },
  { id: 'focusEntity', labelKey: 'director.help.keys.focusEntity' },
  { id: 'captureCamera', labelKey: 'director.help.keys.captureCamera' },
  { id: 'recordMotion', labelKey: 'director.help.keys.recordMotion' },
  { id: 'screenshot', labelKey: 'director.help.keys.screenshot' },
  { id: 'group', labelKey: 'director.help.keys.group' },
  { id: 'ungroup', labelKey: 'director.help.keys.ungroup' },
  { id: 'pasteBackward', labelKey: 'director.help.keys.cloneEntity' },
  { id: 'deleteSelection', labelKey: 'director.help.keys.deleteSelection' },
  { id: 'undo', labelKey: 'director.help.keys.undo' },
  { id: 'redo', labelKey: 'director.help.keys.redo' },
]

const MOUSE_ROWS: FixedRow[] = [
  { keys: 'LMB', labelKey: 'director.help.mouse.pick' },
  { keys: 'LMB ⇄', labelKey: 'director.help.mouse.orbit' },
  { keys: 'RMB ⇄', labelKey: 'director.help.mouse.pan' },
  { keys: 'Wheel', labelKey: 'director.help.mouse.zoom' },
  { keys: 'LMB ×2', labelKey: 'director.help.mouse.pov' },
  { keys: 'Esc', labelKey: 'director.help.mouse.escape' },
]

const TIMELINE_ROWS: HotkeyRow[] = [
  { id: 'togglePlay', labelKey: 'director.help.keys.togglePlay' },
  { id: 'insertKeyframe', labelKey: 'director.help.keys.insertKeyframe' },
  { id: 'prevFrame', labelKey: 'director.help.keys.prevFrame' },
  { id: 'nextFrame', labelKey: 'director.help.keys.nextFrame' },
  { id: 'prev10Frames', labelKey: 'director.help.keys.prev10Frames' },
  { id: 'next10Frames', labelKey: 'director.help.keys.next10Frames' },
  { id: 'prevSplitPoint', labelKey: 'director.help.keys.prevSplitPoint' },
  { id: 'nextSplitPoint', labelKey: 'director.help.keys.nextSplitPoint' },
  { id: 'copy', labelKey: 'director.help.keys.copy' },
  { id: 'paste', labelKey: 'director.help.keys.paste' },
  { id: 'pasteBackward', labelKey: 'director.help.keys.pasteBackward' },
  { id: 'cutLeft', labelKey: 'director.help.keys.cutLeft' },
  { id: 'cutRight', labelKey: 'director.help.keys.cutRight' },
  { id: 'splitClip', labelKey: 'director.help.keys.splitClip' },
  { id: 'deleteSelection', labelKey: 'director.help.keys.deleteClip' },
]

const ROAM_ROWS: FixedRow[] = [
  { keys: 'W A S D', labelKey: 'director.help.roam.move' },
  { keys: 'E / Q', labelKey: 'director.help.roam.lift' },
  { keys: 'Shift', labelKey: 'director.help.roam.boost' },
  { keys: '← → ↑ ↓', labelKey: 'director.help.roam.turn' },
]

function Kbd({ children }: { children: React.ReactNode }): JSX.Element {
  return <kbd className="shrink-0 rounded border border-nomi-line bg-nomi-bg px-1 font-nomi-mono text-micro text-nomi-ink-60">{children}</kbd>
}

function Column({ title, rows }: { title: string; rows: Array<{ label: string; keys: string }> }): JSX.Element {
  return (
    <section className="min-w-0">
      <h3 className="mb-1 text-micro font-semibold uppercase tracking-wide text-nomi-ink-40">{title}</h3>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={`${row.label}-${row.keys}`} className="flex items-start justify-between gap-2 text-caption leading-snug text-nomi-ink-80">
            <span className="min-w-0">{row.label}</span>
            <Kbd>{row.keys}</Kbd>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const label = (key: string) => t(key as 'director.help.title')
  const hotkeyRows = (rows: HotkeyRow[]) => rows.map((row) => ({ label: label(row.labelKey), keys: formatHotkey(DIRECTOR_HOTKEYS[row.id]) }))
  const fixedRows = (rows: FixedRow[]) => rows.map((row) => ({ label: label(row.labelKey), keys: row.keys }))
  // 漫游列末尾带上归位 / 聚焦两条真键位，读者不用跳到工具列找
  const roamRows = [...fixedRows(ROAM_ROWS), ...hotkeyRows([{ id: 'resetCamera', labelKey: 'director.help.keys.resetCamera' }, { id: 'focusEntity', labelKey: 'director.help.keys.focusEntity' }])]

  return (
    <DesignModal opened={open} onClose={onClose} title={t('director.help.title')} size="xl" centered>
      <div className="flex flex-col gap-3" data-nomi-escape-layer="director-help" data-testid="director-help-dialog">
        <p className="text-caption text-nomi-ink-60">{t('director.help.scopeHint')}</p>
        <div className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-4">
          <Column title={t('director.help.colTools')} rows={hotkeyRows(TOOL_ROWS)} />
          <Column title={t('director.help.colMouse')} rows={fixedRows(MOUSE_ROWS)} />
          <Column title={t('director.help.colTimeline')} rows={hotkeyRows(TIMELINE_ROWS)} />
          <Column title={t('director.help.colRoam')} rows={roamRows} />
        </div>
        <p className="text-micro text-nomi-ink-40">{t('director.help.roam.speed')}</p>
      </div>
    </DesignModal>
  )
}
