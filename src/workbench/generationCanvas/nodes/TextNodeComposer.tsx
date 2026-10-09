/**
 * 文本节点的「加工框」（Claude Design 拍板稿「文本节点：会加工、看得见」）：和节点同宽、紧贴在节点下面。
 *
 *   [扩写成提示词 · 看图写描述 · 翻译 · 拆成多条 · 续写 / 改写 ▾]
 *   [或者直接说要怎么改                                     ]
 *   [跟随 Agent 的模型 ▾                                  (↑)]
 *
 * 它不是新能力的入口，是已有「文本节点生成」的新门面：
 *   · 点预设 = 把 `meta.textGenPreset` 写到节点上，再走和 ↑ 同一条生成路径（startGenerationFromComposer：
 *     备齐参考、确认口径、进度、取消、失败提示全是原来的）；
 *   · 续写 / 改写 / 重写三种原有写法收进最后那个下拉，功能一个不少；
 *   · 模型默认「跟随 Agent 的模型」（节点上没选文本模型 = 运行时用 Agent 的文本大脑，见 textActions），也可以手动换。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowUp, IconChevronDown } from '@tabler/icons-react'
import { WorkbenchMenu, type WorkbenchMenuAnchorRect, type WorkbenchMenuNode } from '../../../design/menu'
import { cn } from '../../../utils/cn'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { findModelOptionByIdentifier, useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import { TEXT_PROCESS_PRESETS, TEXT_PROCESS_PRESET_IDS, TEXT_PROCESS_PRESET_LABEL_KEY, type TextProcessPresetId } from '../runner/textProcessPresets'
import type { TextGenMode } from '../runner/textGenerationDocument'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { ComposerAnchor } from './composerAnchor'
import { startGenerationFromComposer } from './composerRun'
import { runTextPreset } from './textProcessRun'
import { GENERATE_BUTTON_CLASS } from './nodeComposerStyles'
import { nodeSelectedModelAddress } from './controls/parameterControlModel'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'

type Props = {
  onFeedback: (message: string) => void
  node: GenerationCanvasNode
  visualSize: { width: number; height: number }
  readOnly: boolean
}

const MODE_LABEL_KEY = {
  append: 'generationCommon.composer.append',
  rewrite: 'generationCommon.composer.rewrite',
  replace: 'generationCommon.composer.replace',
} as const satisfies Record<TextGenMode, string>

const MODE_PLACEHOLDER_KEY = {
  append: 'generationCommon.composer.appendPlaceholder',
  rewrite: 'generationCommon.composer.rewritePlaceholder',
  replace: 'generationCommon.composer.replacePlaceholder',
} as const satisfies Record<TextGenMode, string>

/** 去掉 meta 里的某几个键（不留 undefined 空壳）。 */
function withoutKeys(meta: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const next = { ...meta }
  for (const key of keys) delete next[key]
  return next
}

/** 纯文字按钮（预设行 / 下拉触发共用）：24 高、6 内边距、悬停浅灰底。 */
const TEXT_ACTION_CLASS = cn(
  'inline-flex h-6 items-center gap-0.5 whitespace-nowrap rounded-nomi-sm px-1.5 text-caption text-nomi-ink-80',
  'hover:enabled:bg-nomi-ink-05 data-[active=true]:bg-nomi-ink-05',
  'disabled:cursor-not-allowed disabled:text-nomi-ink-30',
)

/** 点开一个下拉的触发钮：按下那一刻量自己的矩形当锚点，菜单往下开、不压自己。 */
function MenuTrigger({
  label,
  ariaLabel,
  items,
  className,
  disabled,
  active,
  testId,
}: {
  label: string
  ariaLabel: string
  items: readonly WorkbenchMenuNode[]
  className: string
  disabled?: boolean
  active?: boolean
  testId: string
}): JSX.Element {
  const [anchor, setAnchor] = React.useState<WorkbenchMenuAnchorRect | null>(null)
  const ref = React.useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={ariaLabel}
        data-active={active || anchor !== null ? 'true' : 'false'}
        data-text-composer={testId}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          const rect = ref.current?.getBoundingClientRect()
          setAnchor((current) => (current || !rect ? null : { left: rect.left, top: rect.top, width: rect.width, height: rect.height }))
        }}
      >
        {label}
        <IconChevronDown size={12} stroke={1.5} aria-hidden="true" className="text-nomi-ink-40" />
      </button>
      {anchor ? (
        <WorkbenchMenu
          open
          onOpenChange={(open) => { if (!open) setAnchor(null) }}
          anchorRect={anchor}
          side="bottom"
          items={items}
          ariaLabel={ariaLabel}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : null}
    </>
  )
}

export default function TextNodeComposer({ onFeedback, node, visualSize, readOnly }: Props): JSX.Element {
  const { t } = useTranslation()
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const nodeId = node.id
  const meta = (node.meta || {}) as Record<string, unknown>
  const locked = Boolean(node.locked) || readOnly
  const status = node.status || 'idle'
  const running = status === 'queued' || status === 'running'
  const explicitMode: TextGenMode | null = meta.textGenMode === 'append' || meta.textGenMode === 'rewrite' || meta.textGenMode === 'replace'
    ? meta.textGenMode
    : null
  const activePreset = typeof meta.textGenPreset === 'string' ? meta.textGenPreset : null

  // 连了几张图：「看图写描述」要有图才做。与运行时同一个解析器（resolveGenerationReferences），只订阅一个数字。
  const imageCount = useGenerationCanvasStore((state) =>
    resolveGenerationReferences(node, { nodes: state.nodes, edges: state.edges }).referenceImages.length,
  )

  const setMeta = React.useCallback((patch: Record<string, unknown>, remove: readonly string[] = []) => {
    if (locked) return
    const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    useGenerationCanvasStore.getState().updateNode(nodeId, { meta: { ...withoutKeys((latest?.meta || {}) as Record<string, unknown>, remove), ...patch } })
  }, [locked, nodeId])

  const start = React.useCallback(async () => {
    const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    if (!latest) return
    try {
      await startGenerationFromComposer(latest, false)
    } catch (error) {
      // 失败都有节点上的错误卡接着说（含「没有可用的文本模型 → 去设置」）；这里只兜没人接住的异常。
      onFeedback(error instanceof Error ? error.message : String(error))
    }
  }, [nodeId, onFeedback])

  const runPreset = React.useCallback((id: TextProcessPresetId) => {
    if (locked || running) return
    runTextPreset(nodeId, id, onFeedback)
  }, [locked, nodeId, onFeedback, running])

  const runInstruction = React.useCallback(() => {
    if (locked || running) return
    // 没点过「续写 / 改写」的人按「要怎么改」就是要按这句话改整篇——明确落成「重写」，不替他悄悄续写。
    setMeta(explicitMode ? {} : { textGenMode: 'replace' }, ['textGenPreset'])
    void start()
  }, [explicitMode, locked, running, setMeta, start])

  const instruction = node.prompt || ''
  const canSend = !locked && !running && (explicitMode !== null || instruction.trim().length > 0)

  // ── 下拉：续写 / 改写 / 重写（原有三种写法）与文本模型 ────────────────────────────────────────
  const modeItems: WorkbenchMenuNode[] = [
    {
      kind: 'radio',
      id: 'mode',
      value: explicitMode ?? '',
      onValueChange: (value) => {
        if (value !== 'append' && value !== 'rewrite' && value !== 'replace') return
        setMeta({ textGenMode: value }, ['textGenPreset'])
        requestAnimationFrame(() => inputRef.current?.focus())
      },
      options: (['append', 'rewrite', 'replace'] as const).map((value) => ({ id: value, value, label: t(MODE_LABEL_KEY[value]) })),
    },
  ]
  const modelOptions = useGenerationModelOptionsState('text').options
  const address = nodeSelectedModelAddress(meta)
  const selected = address.modelKey ? findModelOptionByIdentifier(modelOptions, address.modelKey, address.vendorKey) : null
  const modelLabel = address.modelKey ? (selected?.label || address.modelKey) : t('generationCommon.textProcess.followAgent')
  const modelItems: WorkbenchMenuNode[] = [
    {
      kind: 'radio',
      id: 'model',
      value: address.modelKey ? `${address.vendorKey ?? ''}::${address.modelKey}` : '',
      onValueChange: (value) => {
        if (!value) { setMeta({}, ['modelKey', 'modelAlias', 'modelVendor', 'vendor']); return }
        const option = modelOptions.find((candidate) => `${candidate.vendor ?? ''}::${candidate.value}` === value)
        if (option) setMeta({ modelKey: option.value, ...(option.vendor ? { modelVendor: option.vendor } : {}) }, ['modelAlias', 'vendor'])
      },
      options: [
        { id: 'follow', value: '', label: t('generationCommon.textProcess.followAgent') },
        ...modelOptions.map((option) => ({ id: `${option.vendor ?? ''}::${option.value}`, value: `${option.vendor ?? ''}::${option.value}`, label: option.label })),
      ],
    },
  ]

  return (
    <ComposerAnchor
      inPanel={false}
      anchorRef={anchorRef}
      visualSize={visualSize}
      placement="match-node"
      data-composer-host="canvas"
      className={cn(
        'generation-canvas-v2-node__composer nokey absolute z-[8]',
        // 画布拖动期间隐身（拖节点、拖选区、拖画布平移）：用 visibility 而不是卸载，输入框里没发出去的字不丢。
        'group-data-[dragging=true]/canvas:invisible',
      )}
      style={{ cursor: 'default', userSelect: 'auto', touchAction: 'auto' }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        role="group"
        aria-label={t('generationCommon.textProcess.boxAria')}
        data-text-process-box
        className={cn(
          NODE_SCROLL_REGION_CLASS_NAME,
          'flex flex-col rounded-nomi-lg bg-nomi-paper px-3 pb-2.5 pt-2.5 shadow-nomi-md ring-1 ring-inset ring-nomi-line-soft',
        )}
      >
        <div className="-ml-1.5 flex flex-wrap items-center gap-x-0.5 gap-y-0.5" data-text-process-presets>
          {TEXT_PROCESS_PRESET_IDS.map((id) => {
            const blocked = TEXT_PROCESS_PRESETS[id].needsImage && imageCount === 0
            return (
              <React.Fragment key={id}>
                <button
                  type="button"
                  className={TEXT_ACTION_CLASS}
                  data-preset={id}
                  data-active={activePreset === id && running ? 'true' : 'false'}
                  disabled={locked || running}
                  aria-disabled={blocked || undefined}
                  title={blocked ? t('generationCommon.textProcess.needImageHint') : undefined}
                  onClick={(event) => { event.stopPropagation(); runPreset(id) }}
                >
                  <span className={cn(blocked && 'text-nomi-ink-40')}>{t(TEXT_PROCESS_PRESET_LABEL_KEY[id])}</span>
                </button>
                <span aria-hidden="true" className="text-caption text-nomi-ink-30">·</span>
              </React.Fragment>
            )
          })}
          <MenuTrigger
            label={t('generationCommon.textProcess.modeMenu')}
            ariaLabel={t('generationCommon.textProcess.modeMenuAria')}
            items={modeItems}
            className={TEXT_ACTION_CLASS}
            disabled={locked || running}
            active={explicitMode !== null}
            testId="mode-menu"
          />
        </div>
        <textarea
          ref={inputRef}
          rows={2}
          value={instruction}
          disabled={locked}
          placeholder={explicitMode ? t(MODE_PLACEHOLDER_KEY[explicitMode]) : t('generationCommon.textProcess.placeholder')}
          aria-label={t('generationCommon.textProcess.placeholder')}
          data-text-composer="instruction"
          className={cn(
            'mt-2 h-10 w-full resize-none border-0 bg-transparent p-0 text-body-sm leading-5 text-nomi-ink-80 outline-none',
            'placeholder:text-nomi-ink-40 disabled:cursor-not-allowed',
          )}
          onChange={(event) => useGenerationCanvasStore.getState().updateNode(nodeId, { prompt: event.target.value })}
          onBlur={() => { if (!readOnly) void persistActiveWorkbenchProjectNow().catch(() => {}) }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (canSend) runInstruction()
            }
          }}
          onKeyUp={(event) => event.stopPropagation()}
        />
        <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
          <MenuTrigger
            label={modelLabel}
            ariaLabel={t('generationCommon.textProcess.modelMenuAria')}
            items={modelItems}
            className={cn(TEXT_ACTION_CLASS, '-ml-2 h-7 justify-self-start px-2')}
            disabled={locked || running}
            testId="model-menu"
          />
          <button
            type="button"
            data-bar-segment="generate"
            data-text-composer="send"
            className={cn(GENERATE_BUTTON_CLASS, 'h-7 w-7')}
            aria-label={t('generationCommon.textProcess.send')}
            disabled={!canSend}
            onClick={(event) => { event.stopPropagation(); runInstruction() }}
          >
            {running ? '···' : <IconArrowUp size={14} stroke={1.5} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </ComposerAnchor>
  )
}
