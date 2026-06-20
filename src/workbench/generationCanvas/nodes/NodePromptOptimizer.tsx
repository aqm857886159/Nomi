/**
 * 节点 prompt 的「AI 优化」按钮(下沉成节点通用能力,不在提示词库内重复 —— P1)。
 * 用 Nomi 标记图标,点开说一句想法 → 用文本大脑(与创作助手同脑)流式改写当前 prompt 并逐字回填。
 * 复用现成文本流式管线(runWorkbenchTextTaskStream + prompt_refine),不新建改写通道。
 */
import React from 'react'
import { IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { NomiLogoMark } from '../../../design'
import { getTextBrain } from '../../api/promptLibraryApi'
import { runWorkbenchTextTaskStream } from '../../api/taskApi'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

function buildOptimizePrompt(original: string, idea: string, isVideo: boolean): string {
  const kind = isVideo ? '视频生成' : '图像生成'
  return [
    `你是${kind}提示词专家。请优化下面这条${kind}提示词，让它更具体、更易出好${isVideo ? '片' : '图'}：`,
    `"""\n${original || '(空白，请根据想法补全)'}\n"""`,
    idea ? `结合用户的想法：${idea}` : '',
    isVideo ? '补充镜头运动、节奏、光影、画质等要点；' : '补充光线、构图、风格、画质等要点；',
    '保持原意，只输出优化后的提示词本身，不要解释、不要加引号、不要分点。',
  ].filter(Boolean).join('\n')
}

export function NodePromptOptimizer({ node, isVideo }: { node: GenerationCanvasNode; isVideo: boolean }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [idea, setIdea] = React.useState('')
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const run = React.useCallback(async () => {
    setRunning(true)
    setError(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const brain = await getTextBrain()
      if (!brain) {
        setError('请先在「模型接入」里启用一个文本模型')
        return
      }
      const prompt = buildOptimizePrompt(node.prompt || '', idea.trim(), isVideo)
      let acc = ''
      await runWorkbenchTextTaskStream(
        brain.vendor,
        { kind: 'prompt_refine', prompt, extras: { modelKey: brain.modelKey } },
        {
          signal: ctrl.signal,
          onDelta: (delta) => {
            acc += delta
            // 逐字回填:流式期 persist:false(不进撤销/不落盘),受控编辑器即时重渲。
            useGenerationCanvasStore.getState().updateNode(node.id, { prompt: acc }, { persist: false })
          },
        },
      )
      const final = acc.trim()
      if (final) useGenerationCanvasStore.getState().updateNode(node.id, { prompt: final })
      setOpen(false)
      setIdea('')
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : '优化失败')
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [node.id, node.prompt, idea, isVideo])

  const toggle = React.useCallback(() => {
    if (running) return
    setOpen((prev) => !prev)
    setError(null)
  }, [running])

  return (
    <div className={cn('relative ml-auto')}>
      {open ? (
        <div className={cn('absolute bottom-full right-0 mb-2 w-[260px] z-10', 'bg-nomi-paper border border-nomi-line rounded-nomi shadow-nomi-md p-2.5')}>
          <div className={cn('flex items-center gap-1.5 mb-2 text-caption text-nomi-ink-60')}>
            <NomiLogoMark size={14} />
            说一句想法，Nomi 帮你改这条
          </div>
          <textarea
            className={cn('w-full h-[52px] resize-none rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1.5', 'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40 outline-none focus:border-nomi-accent')}
            value={idea}
            placeholder="如：换成黄昏、情绪更紧张、加点雾气…（留空也能优化）"
            disabled={running}
            aria-label="优化想法"
            onChange={(e) => setIdea(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run() }}
          />
          {error ? <div className={cn('mt-1.5 text-micro text-workbench-danger')}>{error}</div> : null}
          <button
            type="button"
            className={cn('mt-2 w-full h-8 rounded-full cursor-pointer border-0 text-caption font-semibold', 'bg-nomi-ink text-nomi-paper hover:bg-nomi-accent disabled:opacity-60', 'transition-[background] duration-[var(--nomi-transition-fast)]')}
            disabled={running}
            onClick={() => void run()}
          >
            {running ? '优化中…' : '优化这条提示词'}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={cn('inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-full cursor-pointer', 'border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-caption', 'hover:border-nomi-accent hover:text-nomi-ink transition-[border-color,color] duration-[var(--nomi-transition-fast)]')}
        aria-label="用 Nomi 优化提示词"
        title="用 Nomi 优化提示词"
        onClick={toggle}
      >
        {open ? <IconX size={14} stroke={1.8} /> : <NomiLogoMark size={14} />}
        优化
      </button>
    </div>
  )
}
