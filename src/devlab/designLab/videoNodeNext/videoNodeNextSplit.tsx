// 设计实验室 · 屏「视频节点的下一步」· 「按镜头拆」面板加「拆成：图片 / 视频片段」。
//
// 面板本体是生产的 `NodeShotCutPanel`——联系表、灵敏度、勾选、「全选」、主按钮在右，一样不少。要它跑得起来，实验室替它补了两样**宿主**：
//   · 一个打开的项目（生产自己的 `createProjectCanvasReadSurfaceCoordinator` + 注册，和单测同一个配方），
//   · 一条假的 `video.detectShotCuts`（返回夹具视频的 4 个切点和一张联系表）。
// 面板里**新增**的只有一块：主按钮左边的「拆成 [图片｜视频片段]」二选一（生产的 `NomiSegmented`），
// 选了「视频片段」主按钮改说「拆成 N 段视频」。生产面板还没有这块，所以样张把它挂进面板底栏
// （挂载后把一个宿主 span 插到主按钮前面，再用 portal 渲进去）；拍板接线时它就是面板里的一行 JSX，这段挂载代码整段删掉。
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import NodeShotCutPanel from '../../../workbench/generationCanvas/nodes/NodeShotCutPanel'
import { NomiSegmented } from '../../../design/NomiSegmented'
import { createProjectCanvasReadSurfaceCoordinator, registerProjectCanvasReadSurfaceCoordinator } from '../../../workbench/project/projectCanvasReadSurface'
import type { CanvasReadSurfaceBridge } from '../../../../electron/shared/surfacePortBinding'
import i18n from '../../../i18n'
import { holdDesignLabReady } from '../labReadyHold'
import { installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { COPY, timecode, type VnLocale } from './videoNodeNextCopy'
import { CUT_SECONDS, DURATION_SECONDS, SHEET, SHEET_VIDEO } from './videoNodeNextFixtures'
import { LabStage, NextVideoToolbar, useLocaleHold, useSeededSource, VideoCard, videoSourceNode, VN_CARD, VN_CELL_WIDTH } from './videoNodeNextToolbarKit'

export type SplitMode = 'image' | 'video'

/** 假项目：生产的协调器 + 一座永远答应的桥。卸载时注销。 */
function useFakeOpenProject(): boolean {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    const coordinator = createProjectCanvasReadSurfaceCoordinator({
      createSurfaceInstanceId: () => 'video-node-next-lab-window',
      getSurfaceBridge: () => ({
        suspend: async () => ({ suspension: {} }),
        release: async () => ({ released: true }),
        commitCanvasRead: async ({ projectId }: { projectId: string }) => ({
          binding: { binding: { projectId, immutableProjectUuid: '22222222-2222-4222-8222-222222222222', projectGeneration: 1 } },
        }),
      } as unknown as CanvasReadSurfaceBridge),
    })
    const unregister = registerProjectCanvasReadSurfaceCoordinator(coordinator)
    void coordinator.beginHydration().commitCanvasRead('video-node-next-lab-project').then(() => {
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true; unregister() }
  }, [])
  return ready
}

/**
 * 假检测桥。图片模式 = 4 个切点（每个切点一张起点帧，和今天一样）；
 * 视频片段模式 = 5 段（0:00 起的第一段也要有一格）：N 个切点切出 N+1 段，格子数、标题数、按钮数、结果卡数都是 5。
 * 生产接线时这一点在面板里算：视频模式下在切点数组前补一个 0 秒的「起点」。
 */
function installDetectBridge(mode: SplitMode): void {
  installCatalogBridge()
  const starts = mode === 'video' ? [0, ...CUT_SECONDS] : [...CUT_SECONDS]
  const host = window as unknown as { nomiDesktop: Record<string, unknown> }
  host.nomiDesktop.video = {
    detectShotCuts: async () => ({
      cuts: starts.map((seconds, index) => ({ seconds, score: [0.9, 0.62, 0.48, 0.71, 0.55][mode === 'video' ? index : index + 1] ?? 0.5 })),
      durationSeconds: DURATION_SECONDS,
      sheetUrl: mode === 'video' ? SHEET_VIDEO : SHEET,
      sheetColumns: starts.length,
      sheetRows: 1,
      coverage: { detectedCuts: starts.length, keptCuts: starts.length, appliedThreshold: 0.1, capped: false, coveredSeconds: DURATION_SECONDS, durationSeconds: DURATION_SECONDS },
    }),
  }
}

/** 视频模式：每格的时间写成起止区间（面板自己写的是单个起点 m:ss）。接线时这是面板里按模式换的一行文案。 */
function useRangeLabels(enabled: boolean): void {
  React.useEffect(() => {
    if (!enabled) return undefined
    const starts = [0, ...CUT_SECONDS]
    const ends = [...CUT_SECONDS, DURATION_SECONDS]
    const apply = (): void => {
      document.querySelectorAll<HTMLElement>('[data-shot-cut]').forEach((tile) => {
        const index = Number(tile.getAttribute('data-shot-cut'))
        const label = tile.querySelector<HTMLElement>(':scope > span:last-child > span:first-child')
        const text = `${timecode(starts[index] ?? 0)}–${timecode(ends[index] ?? DURATION_SECONDS)}`
        if (label && label.textContent !== text) label.textContent = text
      })
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  }, [enabled])
}

/** 视频模式下主按钮的字：「拆成 N 段视频」，N 取面板自己数的格子数（视频模式每段一格，全选 = 5）。 */
function overrideCommitLabel(locale: VnLocale, mode: SplitMode): void {
  if (mode !== 'video') return
  i18n.addResource(locale, 'translation', 'generationCommon.node.shotCuts.commit', COPY[locale].splitCommitVideo)
}

/** 把一个宿主 span 插到面板底栏主按钮之前；返回它（面板重渲染把它挤掉时重新插）。 */
function useFooterSlot(enabled: boolean, release: () => void): HTMLElement | null {
  const [slot, setSlot] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    if (!enabled) return undefined
    let frame = 0
    let tries = 0
    const tick = (): void => {
      tries += 1
      const commit = document.querySelector<HTMLElement>('[data-shot-cut-commit]')
      const group = commit?.parentElement
      const hasTiles = Boolean(document.querySelector('[data-shot-cut]'))
      if (commit && group && hasTiles) {
        const host = document.createElement('span')
        host.setAttribute('data-vn-split-mode-slot', 'true')
        host.className = 'inline-flex items-center'
        group.insertBefore(host, commit)
        setSlot(host)
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => release()) })
        return
      }
      if (tries > 480) { release(); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame) }
  }, [enabled, release])
  return slot
}

export function SplitStage({ locale, mode }: { locale: VnLocale; mode: SplitMode }): JSX.Element {
  const c = COPY[locale]
  const node = React.useMemo(() => videoSourceNode(locale), [locale])
  const seeded = useSeededSource(node)
  const localeReady = useLocaleHold(locale)
  // 一把贯穿到底的 hold：从挂载握到底栏的二选一挂好（中途放手再登记会留空档，就绪旗正好在空档里举起来）。
  const holdRef = React.useRef<(() => void) | null>(null)
  React.useLayoutEffect(() => {
    holdRef.current = holdDesignLabReady('video-node-next:split')
    return () => { holdRef.current?.(); holdRef.current = null }
  }, [])
  // 二选一是真有状态的：点哪边哪边高亮（样张只管摆在底栏里的样子，选中项由这一格的初值给出）。
  const [chosen, setChosen] = React.useState<SplitMode>(mode)
  React.useEffect(() => { setChosen(mode) }, [mode])
  const releaseHold = React.useCallback(() => { holdRef.current?.(); holdRef.current = null }, [])
  const projectReady = useFakeOpenProject()
  const ready = seeded && localeReady && projectReady
  // 语言切完、项目开好之后才改主按钮文案（同步写资源，面板首次渲染就读到）。
  // 种夹具的布局副作用会重装一次桥（`installCatalogBridge` 整个换掉 nomiDesktop），所以检测桥要在它之后、面板挂载之前装。
  const labelled = React.useMemo(() => { if (ready) { installDetectBridge(mode); overrideCommitLabel(locale, mode) } return ready }, [locale, mode, ready])
  const slot = useFooterSlot(labelled, releaseHold)
  useRangeLabels(labelled && mode === 'video')
  return (
    <LabStage height={640}>
      {labelled ? (
        <>
          <VideoCard left={Math.round((VN_CELL_WIDTH - VN_CARD.width) / 2)} top={220} title={node.title} toolbar={<NextVideoToolbar node={node} locale={locale} />} />
          <NodeShotCutPanel node={node} onFeedback={() => undefined} onClose={() => undefined} />
          {slot ? createPortal(
            <span className="mr-1 inline-flex items-center gap-2">
              <span className="whitespace-nowrap text-body-sm text-nomi-ink-60">{c.splitInto}</span>
              <NomiSegmented
                ariaLabel={c.splitInto}
                density="compact"
                fit="content"
                value={chosen}
                onChange={(next) => setChosen(next as SplitMode)}
                options={[
                  { value: 'image', label: c.splitImage },
                  { value: 'video', label: c.splitVideo },
                ]}
              />
            </span>,
            slot,
          ) : null}
        </>
      ) : null}
    </LabStage>
  )
}
