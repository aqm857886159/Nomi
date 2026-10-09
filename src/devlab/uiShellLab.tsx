import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { canvasToolbarNodeKinds, type CanvasToolbarNodeKind } from '../workbench/generationCanvas/components/canvasToolbarModel'
import { getGenerationNodeIcon } from '../workbench/generationCanvas/nodes/renderRegistry'
import { NodeEmptyState } from '../workbench/generationCanvas/nodes/render/NodeEmptyState'

export type UiShellLabState = Readonly<{ id: string; name: string; render: () => JSX.Element }>

function LabFrame({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="grid min-h-[24rem] w-[34rem] place-items-center bg-nomi-bg p-8 text-nomi-ink">{children}</div>
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
 * 已知落差（诚实标注）：剪辑节点的空态提示挤在 40px 高的轨道里，生产只渲染 description 那一行，
 * 不渲染标题；这里按统一节奏连标题一起显示。
 */
const NODE_EMPTY_COPY: Record<CanvasToolbarNodeKind, {
  name: string
  titleKey: string
  descriptionKey: string
  actionKey?: string
}> = {
  text: { name: '文本节点空态', titleKey: 'generationCommon.nodeEmpty.text.title', descriptionKey: 'generationCommon.nodeEmpty.text.description' },
  image: { name: '图片节点空态', titleKey: 'generationCommon.nodeEmpty.image.title', descriptionKey: 'generationCommon.nodeEmpty.image.description' },
  video: { name: '视频节点空态', titleKey: 'generationCommon.nodeEmpty.video.title', descriptionKey: 'generationCommon.nodeEmpty.video.description' },
  clip: { name: '剪辑节点空态', titleKey: 'generationCommon.nodeEmpty.clip.title', descriptionKey: 'generationCommon.nodeEmpty.clip.description' },
  audio: { name: '声音节点空态', titleKey: 'generationCommon.nodeEmpty.audio.title', descriptionKey: 'generationCommon.nodeEmpty.audio.description' },
  model3d: { name: '3D 模型节点空态', titleKey: 'generationCommon.nodeEmpty.model3d.title', descriptionKey: 'generationCommon.nodeEmpty.model3d.description' },
  whiteboard: { name: '画板节点空态', titleKey: 'generationCommon.nodeEmpty.whiteboard.title', descriptionKey: 'generationCommon.nodeEmpty.whiteboard.description', actionKey: 'generationCommon.nodeEmpty.whiteboard.action' },
  panorama: { name: '全景节点空态', titleKey: 'generationCommon.nodeEmpty.panorama.title', descriptionKey: 'generationCommon.nodeEmpty.panorama.description', actionKey: 'generationCommon.node.uploadPanorama' },
  director: { name: '导演台节点空态', titleKey: 'generationCommon.nodeEmpty.director.title', descriptionKey: 'generationCommon.nodeEmpty.director.description', actionKey: 'generationCommon.nodeEmpty.director.action' },
}

function NodeEmptyLabCell({ kind }: { kind: CanvasToolbarNodeKind }): JSX.Element {
  const { t } = useTranslation()
  const copy = NODE_EMPTY_COPY[kind]
  const Icon = getGenerationNodeIcon(kind)
  const literal = 'generationCommon.nodeEmpty.image.title' as const
  return (
    <LabFrame>
      <div className="h-64 w-[26rem] rounded-nomi border border-nomi-line bg-nomi-paper">
        <NodeEmptyState
          icon={<Icon size={20} stroke={1.6} />}
          title={t(copy.titleKey as typeof literal)}
          description={t(copy.descriptionKey as typeof literal)}
          action={copy.actionKey
            ? <span className="rounded-nomi-sm bg-nomi-ink px-3 py-1.5 text-caption font-medium text-nomi-paper">{t(copy.actionKey as typeof literal)}</span>
            : undefined}
        />
      </div>
    </LabFrame>
  )
}

const nodeStates: readonly UiShellLabState[] = (canvasToolbarNodeKinds() as CanvasToolbarNodeKind[]).map((kind) => ({
  id: `node-empty-${kind}`,
  name: NODE_EMPTY_COPY[kind].name,
  render: () => <NodeEmptyLabCell kind={kind} />,
}))

// 原来这里还有四格「版本弹窗」：本文件不挂在任何屏上、那四格从没被截过图，2026-10-08 由设计实验室
// `update-reminder` 屏取代并删除。剩下的节点空态清单留着，是因为它的 Record 键类型是工具栏节点种类的编译期护栏。
export const UI_SHELL_STATES: readonly UiShellLabState[] = nodeStates

export function findUiShellState(id: string | null): UiShellLabState | null {
  return UI_SHELL_STATES.find((state) => state.id === id) ?? null
}
