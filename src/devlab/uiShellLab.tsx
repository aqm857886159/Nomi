import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { canvasToolbarNodeKinds, type CanvasToolbarNodeKind } from '../workbench/generationCanvas/components/canvasToolbarModel'
import { getGenerationNodeIcon } from '../workbench/generationCanvas/nodes/renderRegistry'
import { NodeEmptyState } from '../workbench/generationCanvas/nodes/render/NodeEmptyState'
import { ClipEmptyTry, NodeTryList } from '../workbench/generationCanvas/quickActions/NodeTryList'
import type { GenerationCanvasNode } from '../workbench/generationCanvas/model/generationCanvasTypes'
import { UpdaterDialog } from '../ui/app-shell/UpdaterDialog'
import type { Updater } from '../ui/app-shell/useUpdater'
import type { UpdaterPhase } from '../ui/app-shell/useUpdater'

export type UiShellLabState = Readonly<{ id: string; name: string; render: () => JSX.Element }>

const updater = (phase: UpdaterPhase, overrides: Partial<Updater> = {}): Updater => ({
  phase,
  appInfo: { version: '0.21.0', platform: 'darwin', arch: 'arm64', canAutoInstall: true, canCheckUpdates: true },
  latestVersion: '0.22.0',
  notes: '## 这次更新\n\n- 生成任务可以继续在后台运行\n- 画布节点空态更清晰',
  percent: 48,
  errorMessage: '更新服务器暂时不可用',
  supported: true,
  canAutoInstall: true,
  canCheckUpdates: true,
  check: () => undefined,
  download: () => undefined,
  install: () => undefined,
  openDownload: () => undefined,
  reset: () => undefined,
  ...overrides,
})

function LabFrame({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="grid min-h-[24rem] w-[34rem] place-items-center bg-nomi-bg p-8 text-nomi-ink">{children}</div>
}

function UpdateState({ phase, running = false }: { phase: UpdaterPhase; running?: boolean }): JSX.Element {
  return <LabFrame><UpdaterDialog updater={updater(phase)} hasRunningTask={running} /></LabFrame>
}

/**
 * 空态清单 = **左侧竖排工具栏能创建的节点**，一一对应（2026-09-06 用户拍板）。
 *
 * 为什么以工具栏为准：registry 里注册着 15 种 kind，但其中角色/场景/镜头/关键帧/输出/素材
 * 是 Agent、分镜流程或导入产生的，用户点不出来；给它们画空态样张 = 给不存在的入口做设计。
 * 键类型钉成 `Record<CanvasToolbarNodeKind, …>`：工具栏加一颗按钮而这里没跟上 = **编译错**，
 * 不是等门岗、更不是等人眼（R28 防线建在最早能拦住的那层）。
 *
 * 文案与图标都不在这里自造：图标走 `getGenerationNodeIcon`（左侧栏那颗按钮的同一个出口），
 * 文案走各节点在生产里真正渲染的 i18n 键。实验室要照出现役的样子，不是再画一版（P1）。
 *
 * 图片 / 视频 / 文本 / 剪辑四种（2026-10-08 拍板 ③）不再是「标题 + 一句说明」：空节点显示「试试」（剪辑是
 * 「把视频节点连进来」+「在画布上点选」）——这里挂的就是生产那几个组件本体（NodeTryList / ClipEmptyTry），不抄文案。
 */
type NodeEmptyCopy =
  | { name: string; tryList: true }
  | { name: string; titleKey: string; descriptionKey: string; actionKey?: string }

const NODE_EMPTY_COPY: Record<CanvasToolbarNodeKind, NodeEmptyCopy> = {
  text: { name: '文本节点空态', tryList: true },
  image: { name: '图片节点空态', tryList: true },
  video: { name: '视频节点空态', tryList: true },
  clip: { name: '剪辑节点空态', tryList: true },
  audio: { name: '声音节点空态', titleKey: 'generationCommon.nodeEmpty.audio.title', descriptionKey: 'generationCommon.nodeEmpty.audio.description' },
  model3d: { name: '3D 模型节点空态', titleKey: 'generationCommon.nodeEmpty.model3d.title', descriptionKey: 'generationCommon.nodeEmpty.model3d.description' },
  whiteboard: { name: '画板节点空态', titleKey: 'generationCommon.nodeEmpty.whiteboard.title', descriptionKey: 'generationCommon.nodeEmpty.whiteboard.description', actionKey: 'generationCommon.nodeEmpty.whiteboard.action' },
  panorama: { name: '全景节点空态', titleKey: 'generationCommon.nodeEmpty.panorama.title', descriptionKey: 'generationCommon.nodeEmpty.panorama.description', actionKey: 'generationCommon.node.uploadPanorama' },
  director: { name: '导演台节点空态', titleKey: 'generationCommon.nodeEmpty.director.title', descriptionKey: 'generationCommon.nodeEmpty.director.description', actionKey: 'generationCommon.nodeEmpty.director.action' },
}

const labNode = (kind: CanvasToolbarNodeKind): GenerationCanvasNode => ({ id: `lab-empty-${kind}`, kind, title: '', position: { x: 0, y: 0 }, categoryId: 'shots', meta: {} })

function NodeEmptyLabCell({ kind }: { kind: CanvasToolbarNodeKind }): JSX.Element {
  const { t } = useTranslation()
  const copy = NODE_EMPTY_COPY[kind]
  const Icon = getGenerationNodeIcon(kind)
  const literal = 'generationCommon.nodeEmpty.image.title' as const
  return (
    <LabFrame>
      <div className="h-64 w-[26rem] rounded-nomi border border-nomi-line bg-nomi-paper">
        {'tryList' in copy ? (
          kind === 'clip'
            ? <div className="grid h-full place-items-center"><ClipEmptyTry nodeId={labNode(kind).id} /></div>
            : <NodeEmptyState icon={<Icon size={20} stroke={1.6} />} action={<NodeTryList node={labNode(kind)} />} />
        ) : (
          <NodeEmptyState
            icon={<Icon size={20} stroke={1.6} />}
            title={t(copy.titleKey as typeof literal)}
            description={t(copy.descriptionKey as typeof literal)}
            action={copy.actionKey
              ? <span className="rounded-nomi-sm bg-nomi-ink px-3 py-1.5 text-caption font-medium text-nomi-paper">{t(copy.actionKey as typeof literal)}</span>
              : undefined}
          />
        )}
      </div>
    </LabFrame>
  )
}

const nodeStates: readonly UiShellLabState[] = (canvasToolbarNodeKinds() as CanvasToolbarNodeKind[]).map((kind) => ({
  id: `node-empty-${kind}`,
  name: NODE_EMPTY_COPY[kind].name,
  render: () => <NodeEmptyLabCell kind={kind} />,
}))

export const UI_SHELL_STATES: readonly UiShellLabState[] = [
  { id: 'updater-available', name: '版本弹窗 · 有更新', render: () => <UpdateState phase="available" /> },
  { id: 'updater-downloading', name: '版本弹窗 · 下载中', render: () => <UpdateState phase="downloading" /> },
  { id: 'updater-error', name: '版本弹窗 · 失败', render: () => <UpdateState phase="error" /> },
  { id: 'updater-running-badge', name: '版本弹窗 · 任务运行中角标', render: () => <UpdateState phase="available" running /> },
  ...nodeStates,
]

export function findUiShellState(id: string | null): UiShellLabState | null {
  return UI_SHELL_STATES.find((state) => state.id === id) ?? null
}
