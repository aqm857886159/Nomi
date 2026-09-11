/**
 * 节点 prompt 的「AI 优化」按钮(下沉成节点通用能力,不在提示词库内重复 —— P1)。
 * 用 Nomi 标记图标,点开说一句想法 → 文本大脑(与创作助手同脑)流式改写 →
 * 完成后高亮展示「改了哪些」(diff),用户确认再应用到提示词(creator control:不擅自覆盖)。
 * 复用现成文本流式管线(runWorkbenchTextTaskStream + prompt_refine),不新建改写通道。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { NomiLogoMark, WorkbenchButton } from '../../../design'
import { NodePromptToolIconButton } from './NodePromptToolCluster'
import { getTextBrain } from '../../api/promptLibraryApi'
import { runWorkbenchTextTaskStream } from '../../api/taskApi'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { diffPromptWords } from './promptDiff'
import i18n from '../../../i18n'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'

/** 组改写指令。导出供单测——铁律有没有真进 prompt 必须可验，否则「加了 rubric」只是句口号（W4）。 */
export function buildOptimizePrompt(original: string, idea: string, isVideo: boolean): string {
  const kind = i18n.t(isVideo ? 'generationCommon.optimizer.videoKind' : 'generationCommon.optimizer.imageKind')
  return [
    i18n.t('generationCommon.optimizer.intro', {
      kind,
      resultType: i18n.t(isVideo ? 'generationCommon.optimizer.videoResult' : 'generationCommon.optimizer.imageResult'),
    }),
    `"""\n${original || i18n.t('generationCommon.optimizer.blank')}\n"""`,
    idea ? i18n.t('generationCommon.optimizer.idea', { idea }) : '',
    i18n.t(isVideo ? 'generationCommon.optimizer.videoDetails' : 'generationCommon.optimizer.imageDetails'),
    // W4：视频镜额外注入污染词铁律（director-shot-translation 同源）——运镜/动作描述最容易在这翻车。
    isVideo ? i18n.t('generationCommon.optimizer.pollutionRule') : '',
    i18n.t('generationCommon.optimizer.outputRule'),
  ]
    .filter(Boolean)
    .join('\n')
}

export function NodePromptOptimizer({ node, isVideo }: { node: GenerationCanvasNode; isVideo: boolean }): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [idea, setIdea] = React.useState('')
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [streamed, setStreamed] = React.useState('') // 流式累积(进行中)
  const [result, setResult] = React.useState<string | null>(null) // 完成的优化文本(待确认)
  const originalRef = React.useRef('')
  const abortRef = React.useRef<AbortController | null>(null)

  const reset = React.useCallback(() => {
    setStreamed('')
    setResult(null)
    setError(null)
  }, [])

  const run = React.useCallback(async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    setStreamed('')
    originalRef.current = node.prompt || ''
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const brain = await getTextBrain()
      if (!brain) {
        setError(t('generationCommon.optimizer.configureTextModel'))
        return
      }
      const prompt = buildOptimizePrompt(originalRef.current, idea.trim(), isVideo)
      let acc = ''
      await runWorkbenchTextTaskStream(
        brain.vendor,
        { kind: 'prompt_refine', prompt, extras: { modelKey: brain.modelKey } },
        {
          signal: ctrl.signal,
          onDelta: (delta) => {
            acc += delta
            setStreamed(acc)
          },
        },
      )
      const final = acc.trim()
      if (final) setResult(final)
      else setError(t('generationCommon.optimizer.emptyResult'))
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : t('generationCommon.optimizer.failed'))
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [node.prompt, idea, isVideo, t])

  const apply = React.useCallback(() => {
    if (!result) return
    useGenerationCanvasStore.getState().updateNode(node.id, { prompt: result })
    setOpen(false)
    setIdea('')
    reset()
  }, [result, node.id, reset])

  const toggle = React.useCallback(() => {
    if (running) {
      abortRef.current?.abort()
      return
    }
    setOpen((prev) => {
      if (prev) reset()
      return !prev
    })
  }, [running, reset])

  const diff = result != null ? diffPromptWords(originalRef.current, result) : null

  return (
    // v1.1（2026-09-11 拍板）：触发器降级成 B 簇里那颗缩小一号的纯 icon（保留现役 NomiLogoMark
    // 实心标记），带文字的旧外观与把自己推到行尾的 `ml-auto` 一起删掉——底栏的行尾只留主行动。
    <div className={cn('relative inline-flex')}>
      {open ? (
        <div
          className={cn(
            'absolute bottom-full right-0 mb-2 w-[280px] z-10',
            'bg-nomi-paper border border-nomi-line rounded-nomi shadow-nomi-md p-2.5',
          )}
        >
          <div className={cn('flex items-center gap-1.5 mb-2 text-caption text-nomi-ink-60')}>
            <NomiLogoMark size={14} />
            {result != null
              ? t('generationCommon.optimizer.optimizedTitle')
              : t('generationCommon.optimizer.ideaTitle')}
          </div>

          {result != null ? (
            <>
              <div
                className={cn(
                  NODE_SCROLL_REGION_CLASS_NAME,
                  'max-h-[160px] overflow-y-auto rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1.5 text-body-sm leading-relaxed text-nomi-ink',
                )}
              >
                {diff!.map((seg, i) => (
                  <span
                    key={i}
                    className={seg.added ? cn('bg-nomi-accent-soft text-nomi-accent rounded-nomi-sm px-px') : undefined}
                  >
                    {seg.text}
                  </span>
                ))}
              </div>
              <div className={cn('mt-2 flex gap-2')}>
                <WorkbenchButton variant="primary" className="flex-1" onClick={apply}>
                  {t('generationCommon.optimizer.apply')}
                </WorkbenchButton>
                <WorkbenchButton variant="default" onClick={() => void run()}>
                  {t('generationCommon.optimizer.retry')}
                </WorkbenchButton>
              </div>
            </>
          ) : running ? (
            <div
              className={cn(
                'rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1.5 min-h-[52px] text-body-sm leading-relaxed text-nomi-ink-80 whitespace-pre-wrap',
              )}
            >
              {streamed || t('generationCommon.optimizer.optimizing')}
            </div>
          ) : (
            <>
              <textarea
                className={cn(
                  NODE_SCROLL_REGION_CLASS_NAME,
                  'w-full h-[52px] resize-none rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1.5',
                  'text-body-sm text-nomi-ink placeholder:text-nomi-ink-60 outline-none focus:border-nomi-accent',
                )}
                value={idea}
                placeholder={t('generationCommon.optimizer.placeholder')}
                aria-label={t('generationCommon.optimizer.ideaAria')}
                onChange={(e) => setIdea(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run()
                }}
              />
              {error ? <div className={cn('mt-1.5 text-micro text-workbench-danger')}>{error}</div> : null}
              <WorkbenchButton variant="primary" className="mt-2 w-full" onClick={() => void run()}>
                {t('generationCommon.optimizer.optimizePrompt')}
              </WorkbenchButton>
            </>
          )}
        </div>
      ) : null}

      <NodePromptToolIconButton
        toolId="optimize"
        icon={open ? <IconX size={16} stroke={2} /> : <NomiLogoMark size={16} />}
        label={running ? t('generationCommon.optimizer.running') : t('generationCommon.optimizer.aria')}
        active={running}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      />
    </div>
  )
}
