/**
 * 下游节点输入框里的「引用 · 文本名」小签（Claude Design「文本节点：会加工、看得见」）。
 *
 * 文本连到图片 / 视频 / 3D / 文本时，正文会被拼进这个节点的提示词。以前那段字对方的输入框里一个都看不到
 * （说的 ≠ 摆的，铁律⑩）。小签把「接了哪几段、什么顺序」摆出来，悬停小窗写「生成时接在提示词后面」并显示那段正文。
 *
 * 它**只读** `projectConnectedTextInputs`——和生成时真正拼提示词的是同一个投影，所以摆的就是发的
 * （测试 `ConnectedTextChips.test.tsx` 证明两边同源）。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconFileText } from '@tabler/icons-react'
import { AnchoredPopover } from '../../../design'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { projectConnectedTextInputs, type ConnectedTextInput } from '../runner/connectedTextPrompt'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

function ConnectedTextChip({ input }: { input: ConnectedTextInput }): JSX.Element {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLSpanElement>(null)
  const [hover, setHover] = React.useState(false)
  const title = input.title.trim() || t('generationCommon.textProcess.refUntitled')
  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        role="note"
        data-connected-text-chip={input.sourceId}
        aria-label={t('generationCommon.textProcess.refAria', { title })}
        className={cn(
          'inline-flex h-6 max-w-full items-center gap-[5px] rounded-nomi-sm bg-nomi-ink-05 pl-1.5 pr-2 text-caption text-nomi-ink-80',
          'ring-1 ring-inset ring-nomi-line-soft hover:bg-nomi-ink-10 focus-visible:bg-nomi-ink-10 focus-visible:outline-none',
        )}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        <IconFileText size={14} stroke={1.5} aria-hidden="true" className="shrink-0 text-nomi-ink-60" />
        <span className="shrink-0 text-nomi-ink-40">{t('generationCommon.textProcess.refKind')}</span>
        <span className="truncate">{title}</span>
      </span>
      {hover ? (
        <AnchoredPopover anchorRef={ref} side="bottom" align="start" gap={6} passThrough>
          <div
            role="tooltip"
            data-connected-text-popover
            className="w-[min(356px,calc(100vw-32px))] rounded-nomi bg-nomi-paper px-3 py-2.5 shadow-nomi-lg ring-1 ring-inset ring-nomi-line-soft"
          >
            <div className="text-micro font-semibold leading-4 text-nomi-ink-40">{t('generationCommon.textProcess.refHint')}</div>
            <div className="mt-1 max-h-40 overflow-hidden whitespace-pre-wrap break-words text-caption leading-[18px] text-nomi-ink-80">{input.text}</div>
          </div>
        </AnchoredPopover>
      ) : null}
    </>
  )
}

/** 小签那一排（纯展示：给什么摆什么）。 */
export function ConnectedTextChipList({ inputs }: { inputs: readonly ConnectedTextInput[] }): JSX.Element | null {
  if (inputs.length === 0) return null
  return (
    <div data-connected-text-chips className="flex flex-wrap items-center gap-1.5">
      {inputs.map((input) => <ConnectedTextChip key={input.sourceId} input={input} />)}
    </div>
  )
}

export function ConnectedTextChips({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  // 订阅**字符串**：对象选择器每次新引用会让整个浮框跟着任何画布写入重渲。
  const key = useGenerationCanvasStore((state) => JSON.stringify(projectConnectedTextInputs(node, { nodes: state.nodes, edges: state.edges })))
  const inputs = React.useMemo(() => JSON.parse(key) as ConnectedTextInput[], [key])
  return <ConnectedTextChipList inputs={inputs} />
}
