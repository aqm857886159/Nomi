import { memo, useState, type ReactNode } from 'react'
import { IconChevronDown, IconCopy, IconPhoto } from '@tabler/icons-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Token-styled Markdown renderer (single source of truth — used by both the file
 * preview and the AI chat panel).
 *
 * react-markdown emits bare HTML tags that, after Tailwind's preflight reset,
 * render with no hierarchy — so every tag is explicitly mapped to design-system
 * tokens here (font sizes, ink ladder, mono code, accent links).
 *
 * `remark-gfm` enables GitHub-Flavored Markdown — **tables, strikethrough, task
 * lists, autolinks** — which LLM replies use constantly; without it a `| a | b |`
 * table renders as raw pipe text (2026-06-22 真机实测 bug). The extra `table/
 * thead/th/td/del/input` tags GFM emits are token-mapped below.
 *
 * `compact` tightens spacing + shrinks headings for narrow contexts like chat
 * bubbles; the default (doc) spacing suits the wider file-preview panel.
 */
type MarkdownProfile = 'agent-v4'

function makeComponents(compact: boolean, profile?: MarkdownProfile, labels?: MarkdownLabels): Components {
  const pMy = compact ? 'my-1' : 'my-2'
  const hMt = compact ? 'mt-2.5' : 'mt-4'
  const hMb = compact ? 'mb-1' : 'mb-2'
  const h1 = compact ? 'text-title' : 'text-h2'
  const h2 = compact ? 'text-body' : 'text-title'
  const h3 = compact ? 'text-body-sm' : 'text-body'
  return {
    h1: ({ node: _n, ...p }) => <h1 className={`${h1} font-semibold leading-snug text-nomi-ink ${hMt} ${hMb} first:mt-0`} {...p} />,
    h2: ({ node: _n, ...p }) => <h2 className={`${h2} font-semibold leading-snug text-nomi-ink ${hMt} ${hMb} first:mt-0`} {...p} />,
    h3: ({ node: _n, ...p }) => <h3 className={`${h3} font-semibold leading-snug text-nomi-ink ${hMt} ${hMb} first:mt-0`} {...p} />,
    p: ({ node: _n, ...p }) => <p className={`text-body leading-relaxed text-nomi-ink-80 ${pMy}`} {...p} />,
    ul: ({ node: _n, className, ...p }) => {
      const isTask = /contains-task-list/.test(className || '')
      return <ul className={`${isTask ? 'list-none pl-1' : 'list-disc pl-5'} ${pMy} text-body leading-relaxed text-nomi-ink-80`} {...p} />
    },
    ol: ({ node: _n, ...p }) => <ol className={`list-decimal pl-5 ${pMy} text-body leading-relaxed text-nomi-ink-80`} {...p} />,
    li: ({ node: _n, className, ...p }) => <li className={`my-0.5 ${/task-list-item/.test(className || '') ? 'list-none' : ''}`.trim()} {...p} />,
    a: ({ node: _n, children, ...p }) => <a className="text-nomi-accent underline underline-offset-2 [overflow-wrap:anywhere]" target="_blank" rel="noreferrer" {...p}>{children}{profile === 'agent-v4' ? <span aria-hidden="true" className="ml-0.5 no-underline">↗</span> : null}</a>,
    blockquote: ({ node: _n, ...p }) => <blockquote className={`border-l-2 border-nomi-line pl-3 ${pMy} text-nomi-ink-60`} {...p} />,
    hr: ({ node: _n, ...p }) => <hr className="border-nomi-line my-3" {...p} />,
    strong: ({ node: _n, ...p }) => <strong className="font-semibold text-nomi-ink" {...p} />,
    del: ({ node: _n, ...p }) => <del className="line-through text-nomi-ink-60" {...p} />,
    code: ({ node: _n, className, children, ...p }) => {
      const isBlock = String(className || '').includes('language-')
      return isBlock
        ? <code className={`font-nomi-mono text-caption ${className || ''}`.trim()} {...p}>{children}</code>
        : <code className="font-nomi-mono text-caption bg-nomi-ink-05 rounded-nomi-sm px-1 py-0.5 [overflow-wrap:anywhere]" {...p}>{children}</code>
    },
    pre: ({ node: _n, children, ...p }) => profile === 'agent-v4'
      ? <AgentV4Code labels={labels} {...p}>{children}</AgentV4Code>
      : <pre className={`bg-nomi-ink-05 rounded-nomi-sm p-3 ${pMy} overflow-auto text-nomi-ink-80`} {...p}>{children}</pre>,
    img: ({ node: _n, alt }) => profile === 'agent-v4'
      ? <span className="inline-flex items-center gap-1 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 px-1.5 py-0.5 text-caption text-nomi-ink-60"><IconPhoto size={12} />{alt || labels?.imageLabel}</span>
      : <img alt={alt} />,
    // GFM 表格：token 化 + 整体可横向滚动（窄聊天列不溢出/不撑破气泡）。
    table: ({ node: _n, ...p }) => (
      <div className={`${pMy} max-w-full overflow-x-auto`}>
        <table className="w-full text-caption border-collapse" {...p} />
      </div>
    ),
    thead: ({ node: _n, ...p }) => <thead className="border-b border-nomi-line" {...p} />,
    th: ({ node: _n, ...p }) => <th className="px-2 py-1 text-left font-semibold text-nomi-ink border border-nomi-line" {...p} />,
    td: ({ node: _n, ...p }) => <td className="px-2 py-1 text-nomi-ink-80 border border-nomi-line align-top" {...p} />,
    // 任务清单复选框（GFM 输出 disabled input）：token 强调色 + 与文字对齐。
    input: ({ node: _n, ...p }) => <input className="mr-1.5 align-middle accent-nomi-accent" {...p} disabled />,
  }
}

type MarkdownLabels = { copyLabel: string; imageLabel: string; expandLabel: string; collapseLabel: string }

function AgentV4Code({ children, labels, ...props }: { children?: ReactNode; labels?: MarkdownLabels } & Record<string, unknown>): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const source = String(children ?? '')
  const long = source.split('\n').length > 12
  const copy = () => { void navigator.clipboard?.writeText(source) }
  return <div className="relative my-1"><button type="button" onClick={copy} aria-label={labels?.copyLabel} className="absolute right-1 top-1 rounded-nomi-sm p-1 text-nomi-ink-60 hover:bg-nomi-ink-10"><IconCopy size={13} /></button><pre className={`bg-nomi-ink-05 rounded-nomi-sm p-3 pr-8 overflow-auto text-nomi-ink-80 ${long && !expanded ? 'max-h-52' : ''}`} {...props}>{children}</pre>{long ? <button type="button" onClick={() => setExpanded(value => !value)} className="inline-flex items-center gap-1 text-micro text-nomi-ink-60"><IconChevronDown size={12} className={expanded ? 'rotate-180' : undefined} />{expanded ? labels?.collapseLabel : labels?.expandLabel}</button> : null}</div>
}

const docComponents = makeComponents(false)
const compactComponents = makeComponents(true)
// 模块级常量：避免会渲染的那几次给 ReactMarkdown 传新数组引用（触发其内部 effect 重跑）。
const REMARK_PLUGINS = [remarkGfm]

// memo（P0 流式卡顿）：props 仅 children:string + compact:boolean（原始值，默认浅比较即可）。
// 流式时只有「正在吐字那条」的 children 在变 → 它照常重渲重 parse；已 done 的历史气泡 children
// 不变 → memo 跳过，不再每个 token 帧陪绑重新 mdast 解析整段累积全文（这是「对话越长越卡」的放大器）。
export const NomiMarkdown = memo(function NomiMarkdown({
  children,
  compact = false,
  profile,
  copyLabel,
  imageLabel,
  expandLabel,
  collapseLabel,
}: {
  children: string
  compact?: boolean
  profile?: MarkdownProfile
  copyLabel?: string
  imageLabel?: string
  expandLabel?: string
  collapseLabel?: string
}): JSX.Element {
  const labels = profile === 'agent-v4' ? { copyLabel: copyLabel ?? 'Copy', imageLabel: imageLabel ?? 'Image', expandLabel: expandLabel ?? 'Expand', collapseLabel: collapseLabel ?? 'Collapse' } : undefined
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={profile === 'agent-v4' ? makeComponents(compact, profile, labels) : (compact ? compactComponents : docComponents)}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
