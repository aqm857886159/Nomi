import React from 'react'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { canRunGenerationNode, rerunGenerationNodeAsNewNode, runGenerationNode } from '../runner/generationRunController'
import { WorkbenchButton } from '../../../design'
import NodeParameterControls from './NodeParameterControls'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import {
  getGenerationNodeExecutionKind,
  getGenerationNodePromptPlaceholder,
  isImageLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import { getTextGenMode, type TextGenMode } from '../runner/textActions'

// C5 P2：文本节点的三种生成模式。
const TEXT_GEN_MODES: { value: TextGenMode; label: string }[] = [
  { value: 'append', label: '续写' },
  { value: 'rewrite', label: '改写' },
  { value: 'replace', label: '重写' },
]
const TEXT_MODE_PLACEHOLDER: Record<TextGenMode, string> = {
  append: '续写要求…（留空＝直接接着往下写）',
  rewrite: '改写要求…（先在正文里选中要改的文字）',
  replace: '重写要求…（替换整篇）',
}

// 生成节点的浮动 composer：references + 提示词 + 参数 + 生成/重新生成按钮。
// 从 BaseGenerationNode 抽出（A1.5 接缝）：只有「生成类」节点挂它，素材节点不挂。
// 所有生成相关依赖（runner / NodeParameterControls / 布局计算）都收在这里，壳保持 kind 无关。

type Props = {
  node: GenerationCanvasNode
  visualSize: { width: number; height: number }
}

type FloatingComposerLayout = {
  width: number
  maxHeight: number
  gap: number
  promptRows: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function floatingComposerLayout(width: number, height: number, kind: GenerationCanvasNode['kind']): FloatingComposerLayout {
  const aspectRatio = width / Math.max(1, height)
  const aspectWidth = aspectRatio >= 1.55
    ? clampNumber(Math.round(width * 0.88), 360, 440)
    : aspectRatio <= 0.78
      ? clampNumber(Math.round(width * 1.18), 320, 400)
      : clampNumber(Math.round(width * 0.98), 330, 420)
  // 参数已收进设置弹层，底栏只剩 模型芯片+设置芯片+发送 三件，不再按控件数撑宽。
  // 卡片保持紧凑（≤440，对齐样张 v3 的 ~460 设计宽度），密度优先、不留大空框。
  const panelWidth = clampNumber(aspectWidth, 320, 440)
  const maxHeight = clampNumber(Math.round(height * 0.72), 176, kind === 'video' ? 260 : 220)
  const gap = width >= 420 ? 14 : 10
  return {
    width: panelWidth,
    maxHeight,
    gap,
    promptRows: kind === 'video' ? 4 : width >= 420 ? 3 : 2,
  }
}

export default function NodeGenerationComposer({ node, visualSize }: Props): JSX.Element {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const status = node.status || 'idle'
  const isGenerating = status === 'queued' || status === 'running'
  const hasResult = Boolean(node.result?.url)
  const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind)
  // v0.7.2 perf: 用 boolean primitive 订阅 canGenerate
  const canGenerate = useGenerationCanvasStore((state) =>
    canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges }),
  ) && !isGenerating
  const composerLayout = floatingComposerLayout(visualSize.width, visualSize.height, node.kind)
  const isTextKind = node.kind === 'text'
  const textGenMode = getTextGenMode(node)
  // 设置弹层开合：放在 composer 这层，弹层渲染在卡底（参数卡内的最后一块），不被节点 overflow 裁剪。
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  const handleGenerate = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const state = useGenerationCanvasStore.getState()
    if (!canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges })) return
    try {
      if (hasResult) {
        await rerunGenerationNodeAsNewNode(node.id)
      } else {
        await runGenerationNode(node.id)
      }
    } catch {
      // runGenerationNode records the explicit failure on the node; the card renders it below the prompt.
    }
  }

  return (
    // 外层只做定位锚（不裁剪）：参数卡是会滚动的内层；设置弹层作为卡的**兄弟**悬浮在卡下方，
    // 不被卡的 overflow 裁掉（样张 v3：往下弹的独立卡）。
    <div
      className={cn('generation-canvas-v2-node__composer', 'absolute left-1/2 z-[8] -translate-x-1/2')}
      style={{ width: composerLayout.width, top: `calc(100% + ${composerLayout.gap}px)` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          'generation-canvas-v2-node__composer-card',
          'flex flex-col gap-[6px] p-[10px] min-h-[150px]',
          'border border-nomi-line-soft rounded-nomi bg-nomi-paper overflow-auto shadow-nomi-lg',
        )}
        style={{ maxHeight: composerLayout.maxHeight }}
      >
      {isImageLikeGenerationNodeKind(node.kind) || isVideoLikeGenerationNodeKind(node.kind) ? (
        <NodeParameterControls node={node} section="references" />
      ) : null}
      {isTextKind ? (
        <div className={cn('flex items-center gap-1')} role="group" aria-label="生成模式">
          {TEXT_GEN_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              data-active={textGenMode === option.value ? 'true' : 'false'}
              onClick={(event) => {
                event.stopPropagation()
                updateNode(node.id, { meta: { ...(node.meta || {}), textGenMode: option.value } })
              }}
              className={cn(
                'h-[22px] rounded-full px-2.5 text-[11px] font-medium',
                'text-nomi-ink-60 hover:bg-nomi-ink-05',
                'data-[active=true]:bg-nomi-accent-soft data-[active=true]:text-nomi-accent',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        className={cn(
          'generation-canvas-v2-node__prompt-input',
          'flex-1 w-full min-h-[38px] p-0 border-0 outline-0 resize-none',
          'bg-transparent text-nomi-ink font-[inherit] text-[12.5px] leading-[1.5]',
          'placeholder:text-nomi-ink-40',
        )}
        value={node.prompt}
        rows={composerLayout.promptRows}
        placeholder={isTextKind ? TEXT_MODE_PLACEHOLDER[textGenMode] : getGenerationNodePromptPlaceholder(node.kind)}
        onChange={(event) => updateNode(node.id, { prompt: event.currentTarget.value })}
        onBlur={() => { void persistActiveWorkbenchProjectNow().catch(() => {}) }}
      />
      <div className={cn('flex items-center gap-2 mt-auto min-w-0 pt-1')}>
        <NodeParameterControls
          node={node}
          section="parameters"
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
        />
        {(() => {
          const disabledReason = !canGenerate && !isGenerating
            ? nodeExecutionKind === 'video'
              ? '需要先连接一个图片节点作为首帧'
              : nodeExecutionKind === 'image'
                ? undefined
                : `「${node.kind}」类型暂不支持直接生成`
            : undefined
          const title = disabledReason ?? (isGenerating ? '生成中…' : hasResult ? '重新生成' : '生成')
          return (
            <span title={title} style={{ display: 'contents' }}>
              <WorkbenchButton
                className={cn(
                  'inline-flex items-center justify-center shrink-0 w-[30px] h-[30px] p-0',
                  'border-0 rounded-full bg-nomi-ink text-nomi-paper',
                  'font-[inherit] text-[14px] leading-none',
                  'hover:enabled:bg-nomi-accent',
                  'disabled:bg-nomi-ink-20 disabled:text-nomi-ink-40 disabled:cursor-not-allowed',
                )}
                aria-label={hasResult ? '重新生成' : '生成素材'}
                disabled={!canGenerate}
                onClick={handleGenerate}
              >
                {isGenerating ? '···' : '↑'}
              </WorkbenchButton>
            </span>
          )
        })()}
      </div>
      </div>
      {settingsOpen ? (
        <div className={cn('absolute left-0 right-0 top-[calc(100%+6px)] z-[9]')}>
          <NodeParameterControls node={node} section="settings" />
        </div>
      ) : null}
    </div>
  )
}
