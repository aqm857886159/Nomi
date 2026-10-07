/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchIconButton、../../../../../../vendor/tablerIcons、../../../../../../utils/cn、
 *          ../../DirectorEditorContext、../../model/hotkeys
 * [OUTPUT]: 对外提供导演台两个面（导演视图 / 精修）共用的顶栏件：Cluster（功能簇胶囊）、ExitButton（← 退出）、
 *           ViewModeSwitch（导演 | 精修）、HistoryButtons（撤销 / 重做）
 * [POS]: director/panels/topbar 的共享顶栏件。2026-10-04 之前「导演 / 精修」切换、撤销 / 重做、退出在导演视图和精修顶栏里各抄了一份，
 *        位置与图标都不同（退出一边是 ←、一边是 ×），来回切模式时钮会跳——同一动作两个画法。这里是唯一一份，两个面都从这里取。
 *        簇的外形（圆角 / 描边 / 阴影）也只在这里定义一次，不为某个面另造一种。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../../../../design'
import { IconArrowBackUp, IconArrowForwardUp, IconArrowLeft } from '../../../../../../vendor/tablerIcons'
import { cn } from '../../../../../../utils/cn'
import { useDirectorStore } from '../../DirectorEditorContext'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../../model/hotkeys'

/** 一个功能簇 = 一枚浮起的胶囊。边界靠间距和描边，不靠分隔线（设计系统 §1.5.3）。 */
export function Cluster({ label, children, testId, className }: { label: string; children: React.ReactNode; testId?: string; className?: string }): JSX.Element {
  return (
    <div
      className={cn('pointer-events-auto flex items-center gap-1 rounded-nomi-lg border border-nomi-line bg-nomi-paper/95 p-1 shadow-nomi-md backdrop-blur', className)}
      role="group"
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </div>
  )
}

/** 簇内分段的细竖线：只用在同一簇里两组控件之间，簇与簇之间靠间距。 */
export function ClusterDivider(): JSX.Element {
  return <span className="mx-0.5 h-4 w-px bg-nomi-line" aria-hidden />
}

/** 退出导演台：两个面都在左上、都是 ←（回到画布），不再一边 ← 一边 ×。 */
export function ExitButton({ onExit }: { onExit: () => void }): JSX.Element {
  const { t } = useTranslation()
  return <WorkbenchIconButton size="sm" icon={<IconArrowLeft size={16} stroke={1.9} />} label={t('director.editor.exit')} data-testid="director-exit" onClick={onExit} />
}

export type ViewModeValue = 'director' | 'refine'

/** 导演 | 精修。两个面同一枚、都在顶栏正中（三列网格的中列），切换时钮不跳。 */
export function ViewModeSwitch({ mode, onChange, testId }: { mode: ViewModeValue; onChange: (mode: ViewModeValue) => void; testId?: string }): JSX.Element {
  const { t } = useTranslation()
  const option = (value: ViewModeValue, label: string) => (
    <button
      type="button"
      className={cn('rounded-nomi-sm px-3 py-1 text-caption', mode === value ? 'bg-nomi-accent-soft text-nomi-accent' : 'text-nomi-ink-60 hover:text-nomi-ink')}
      aria-pressed={mode === value}
      onClick={mode === value ? undefined : () => onChange(value)}
    >
      {label}
    </button>
  )
  return (
    <Cluster label={t('director.topbar.viewModeAria')} testId={testId}>
      {option('director', t('director.topbar.directorView'))}
      {option('refine', t('director.topbar.refineView'))}
    </Cluster>
  )
}

/** 撤销 / 重做：读写同一个 store 历史栈，名字带快捷键。 */
export function HistoryButtons(): JSX.Element {
  const { t } = useTranslation()
  const canUndo = useDirectorStore((state) => state.undoStack.length > 0)
  const canRedo = useDirectorStore((state) => state.redoStack.length > 0)
  const undo = useDirectorStore((state) => state.undo)
  const redo = useDirectorStore((state) => state.redo)
  return (
    <>
      <WorkbenchIconButton size="sm" icon={<IconArrowBackUp size={16} stroke={1.9} />} label={`${t('director.bottomBar.undo')} (${formatHotkey(DIRECTOR_HOTKEYS.undo)})`} disabled={!canUndo} onClick={() => undo()} />
      <WorkbenchIconButton size="sm" icon={<IconArrowForwardUp size={16} stroke={1.9} />} label={`${t('director.bottomBar.redo')} (${formatHotkey(DIRECTOR_HOTKEYS.redo)})`} disabled={!canRedo} onClick={() => redo()} />
    </>
  )
}
