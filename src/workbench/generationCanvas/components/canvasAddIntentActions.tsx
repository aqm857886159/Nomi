import React, { type JSX } from 'react'
import type { TFunction } from 'i18next'
import { IconPlus, IconUpload } from '../../../vendor/tablerIcons'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { getQuickAddGenerationNodePlugins } from '../nodes/renderRegistry'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { importLocalFilesToGenerationCanvas } from './canvasStageDrop'
import type { CanvasAddIntent } from './canvasToolbarModel'

/**
 * 画布「加东西」意图（canvasToolbarModel 的意图表）的**名字、图标、执行**——左缘工具条、空白处右键菜单、
 * 空画布任务卡（2026-10-08 拍板 ③）三处共用这一份，不各写一套。
 */

const QUICK_ADD_NODE_ITEMS = getQuickAddGenerationNodePlugins()

export function nodeKindLabel(kind: GenerationNodeKind, t: TFunction): string {
  if (kind === 'text') return t('canvas.nodeKinds.text')
  if (kind === 'image') return t('canvas.nodeKinds.image')
  if (kind === 'video') return t('canvas.nodeKinds.video')
  if (kind === 'clip') return t('canvas.nodeKinds.clip')
  if (kind === 'audio') return t('canvas.nodeKinds.audio')
  if (kind === 'model3d') return t('canvas.nodeKinds.model3d')
  if (kind === 'whiteboard') return t('canvas.nodeKinds.whiteboard')
  if (kind === 'panorama') return t('canvas.nodeKinds.panorama')
  if (kind === 'director') return t('canvas.nodeKinds.director')
  return kind
}

/** 菜单里这一条写什么字（节点用种类名；导入那条是「文件…」，段名已经说了「导入」）。 */
export function intentLabel(intent: CanvasAddIntent, t: TFunction): string {
  return intent.kind ? nodeKindLabel(intent.kind, t) : t('canvas.importFile')
}

/** 无障碍名 / tooltip：脱离段名单独读也说得清「按下去会发生什么」。 */
export function intentActionLabel(intent: CanvasAddIntent, t: TFunction): string {
  return intent.kind ? t('canvas.addNode', { type: nodeKindLabel(intent.kind, t) }) : t('canvas.importFileAction')
}

/** 空画布任务卡上的名字：节点用种类名，导入用完整动作名（卡片单独出现，没有段名可借）。 */
export function intentCardLabel(intent: CanvasAddIntent, t: TFunction): string {
  return intent.kind ? nodeKindLabel(intent.kind, t) : t('canvas.importFileAction')
}

export type IntentIcon = (props: { size?: number; stroke?: number }) => JSX.Element

export function intentIcon(intent: CanvasAddIntent): IntentIcon {
  if (!intent.kind) return IconUpload as unknown as IntentIcon
  const plugin = QUICK_ADD_NODE_ITEMS.find((item) => item.kind === intent.kind)
  return (plugin?.icon ?? IconPlus) as unknown as IntentIcon
}

/**
 * 「挑本地文件」的共享小钩子：左缘「导入」钮与右键菜单「导入 · 文件…」用的是**同一个**受控
 * `<input type="file">` 形态与同一套过滤，只是落点不同。选完交给调用方决定落在哪一点。
 */
export function useLocalFilePicker(onFiles: (files: File[]) => void): { input: JSX.Element; open: () => void } {
  const ref = React.useRef<HTMLInputElement>(null)
  const open = React.useCallback(() => {
    ref.current?.click()
  }, [])
  const input = (
    <input
      ref={ref}
      type="file"
      multiple
      // 画布上只有图片 / 视频有落点（音频的家是素材库 → 时间轴），让选择器自己筛掉，
      // 而不是让用户选完再被静默丢弃。
      accept="image/*,video/*"
      className="hidden"
      aria-hidden="true"
      tabIndex={-1}
      onChange={(event) => {
        // 不在这里筛：选中了却落不下的（音频在画布上没有节点可落）必须由导入那条路报出理由。
        // 此前这里先筛一遍、筛空就什么都不做——用户选完一个 mp3，界面一个字都没有（实测静默）。
        const files = Array.from(event.currentTarget.files || [])
        event.currentTarget.value = ''
        if (files.length) onFiles(files)
      }}
    />
  )
  return { input, open }
}

/**
 * 执行一个意图：建节点意图 → 在期望落点建这一类空节点（避让由 store.addNode 统一做）；「导入」→ 系统文件选择器 →
 * **画布现有那条本地文件路径**（拖进画布走的同一条：复制进项目 + 上传 + 建素材卡），不另建一套（P1）。
 */
export function useCanvasAddIntentAction({ getInsertionPosition, categoryId }: {
  getInsertionPosition: () => { x: number; y: number }
  categoryId?: string
}): { run: (intent: CanvasAddIntent) => void; pickerInput: JSX.Element } {
  const picker = useLocalFilePicker((files) => {
    void importLocalFilesToGenerationCanvas(files, { basePosition: getInsertionPosition(), categoryId })
  })
  const run = (intent: CanvasAddIntent) => {
    if (intent.kind) useGenerationCanvasStore.getState().addNode({ kind: intent.kind, position: getInsertionPosition(), categoryId })
    else picker.open()
  }
  return { run, pickerInput: picker.input }
}
