/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton / WorkbenchIconButton、../../../../../../vendor/tablerIcons、
 *          ../../DirectorEditorContext、../../model/hotkeys、../../OutputsContext 的 useOutputs、../viewport/ViewportToolbar、./AddObjectMenu、./ViewMenu、
 *          ../outputs/OutputsPopover
 * [OUTPUT]: 对外提供 DirectorTopBar：导演台唯一的常驻控件条，五个功能簇 ——
 *           ① 场景（图层名 + 切换）｜② 视图（重置视角 / 视图 ▾）｜③ 工具（选择·移动·旋转·缩放 ｜ 画线·逐点）｜
 *           ④ 添加与历史（＋添加 ▾ ｜ 撤销 / 重做）｜⑤ 交付（截图 / 产出 / 退出）
 * [POS]: director/panels/topbar 的装配根。2026-09-09 之前这些控件分在四条带上（顶栏 + 视口左缘 + 视口底中 + 视口右下），
 *        是设计系统 §1.5.4 点名的反例；收成五簇后正好用满 L1「每个面 ≤5 个功能簇」的预算，视口四边不再有控件。
 *        簇与簇之间留 gap 而不是分隔线：§1.5.3 要求分段要有名字或可见边界，浮起来的独立胶囊本身就是边界。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../../../utils/cn'
import { WorkbenchIconButton } from '../../../../../../design'
import { IconArrowBackUp, IconArrowForwardUp, IconCamera, IconChevronDown, IconRefresh, IconStack2, IconX } from '../../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../../model/hotkeys'
import { useOutputs } from '../../OutputsContext'
import { OutputsPopover } from '../outputs/OutputsPopover'
import { Popover, PopoverItem } from '../Popover'
import { ViewportToolbar } from '../viewport/ViewportToolbar'
import { AddObjectMenu } from './AddObjectMenu'
import { ViewMenu } from './ViewMenu'

/** 一个功能簇 = 一枚浮起的胶囊。边界靠间距和描边，不靠分隔线（§1.5.3）。 */
function Cluster({ label, children, testId, className }: { label: string; children: React.ReactNode; testId?: string; className?: string }): JSX.Element {
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

export type DirectorTopBarProps = {
  onResetView: () => void
  onExit: () => void
  onCancelCreation?: () => void
  onOpenSettings?: () => void
  onOpenHelp?: () => void
}

export function DirectorTopBar({ onResetView, onExit, onCancelCreation, onOpenSettings, onOpenHelp }: DirectorTopBarProps): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const outputs = useOutputs()
  const sceneName = useDirectorStore((state) => state.activeScene().name)
  const scenes = useDirectorStore((state) => state.project.scenes)
  const activeSceneId = useDirectorStore((state) => state.project.activeSceneId)
  const canUndo = useDirectorStore((state) => state.undoStack.length > 0)
  const canRedo = useDirectorStore((state) => state.redoStack.length > 0)
  const [sceneMenuOpen, setSceneMenuOpen] = React.useState(false)

  return (
    // 三列网格而非两端撑开：两端撑开只在左右两簇等宽时让中间居中，「场景」宽「交付」窄时工具簇会偏；
    // 中列 auto 才真正落在视口正中（与获批样张一致）。左右两簇各自 justify-self 贴边。
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3" data-testid="director-topbar">
      {/* ① 场景：图层切换。只有一层时禁用并说明为什么（控件契约 C1：可点即有效）。 */}
      <Cluster label={t('director.topbar.sceneAria')} testId="director-scene-cluster" className="justify-self-start">
        <span className="flex items-center gap-1.5 px-2 text-body-sm font-semibold text-nomi-ink">
          <IconStack2 size={16} stroke={1.9} className="text-nomi-ink-40" />
          <span className="max-w-[160px] truncate">{sceneName}</span>
        </span>
        <Popover
          open={sceneMenuOpen}
          onClose={() => setSceneMenuOpen(false)}
          panelClassName="w-[220px] max-h-[320px] overflow-auto"
          trigger={
            <WorkbenchIconButton
              size="sm"
              icon={<IconChevronDown size={16} stroke={1.9} />}
              label={t('director.topbar.sceneAria')}
              disabled={scenes.length < 2}
              title={scenes.length < 2 ? t('director.topbar.onlyOneLayer') : undefined}
              aria-expanded={sceneMenuOpen}
              onClick={() => setSceneMenuOpen((value) => !value)}
            />
          }
        >
          {scenes.map((scene) => (
            <PopoverItem
              key={scene.id}
              onClick={() => {
                store.getState().setActiveScene(scene.id)
                setSceneMenuOpen(false)
              }}
            >
              <span className={scene.id === activeSceneId ? 'flex-1 text-left font-semibold text-nomi-accent' : 'flex-1 text-left'}>{scene.name}</span>
            </PopoverItem>
          ))}
        </Popover>
      </Cluster>

      <div className="flex items-start gap-3">
        {/* ② 视图 */}
        <Cluster label={t('director.topbar.viewAria')} testId="director-view-cluster">
          <WorkbenchIconButton size="sm" icon={<IconRefresh size={16} stroke={1.9} />} label={`${t('director.topbar.resetCamera')} (${formatHotkey(DIRECTOR_HOTKEYS.resetCamera)})`} onClick={onResetView} />
          <ViewMenu onOpenSettings={onOpenSettings} onOpenHelp={onOpenHelp} />
        </Cluster>

        {/* ③ 工具 */}
        <Cluster label={t('director.topbar.toolsAria')}>
          <ViewportToolbar onCancelCreation={onCancelCreation} />
        </Cluster>

        {/* ④ 添加与历史 */}
        <Cluster label={t('director.topbar.createAria')} testId="director-create-cluster">
          <AddObjectMenu />
          <span className="mx-0.5 h-4 w-px bg-nomi-line" aria-hidden />
          <WorkbenchIconButton size="sm" icon={<IconArrowBackUp size={16} stroke={1.9} />} label={`${t('director.bottomBar.undo')} (${formatHotkey(DIRECTOR_HOTKEYS.undo)})`} disabled={!canUndo} onClick={() => store.getState().undo()} />
          <WorkbenchIconButton size="sm" icon={<IconArrowForwardUp size={16} stroke={1.9} />} label={`${t('director.bottomBar.redo')} (${formatHotkey(DIRECTOR_HOTKEYS.redo)})`} disabled={!canRedo} onClick={() => store.getState().redo()} />
        </Cluster>
      </div>

      {/* ⑤ 交付 */}
      <Cluster label={t('director.topbar.deliverAria')} testId="director-deliver-cluster" className="justify-self-end">
        <WorkbenchIconButton
          size="sm"
          icon={<IconCamera size={16} stroke={1.9} />}
          label={`${t('director.bottomBar.screenshot')} (${formatHotkey(DIRECTOR_HOTKEYS.screenshot)})`}
          data-testid="director-screenshot"
          onClick={() => void outputs.takeScreenshot()}
        />
        <OutputsPopover />
        <span className="mx-0.5 h-4 w-px bg-nomi-line" aria-hidden />
        <WorkbenchIconButton size="sm" icon={<IconX size={16} stroke={1.9} />} label={t('director.editor.exit')} data-testid="director-exit" onClick={onExit} />
      </Cluster>
    </div>
  )
}
