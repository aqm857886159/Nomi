import { cloneElement, isValidElement, memo, useId, useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPhoto } from '@tabler/icons-react'
import { Streamdown, type Components, type PluginConfig } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { cjk } from '@streamdown/cjk'
import { codeFenceTypeface } from './codeFenceTypeface'

/** Single Markdown owner. Streamdown owns parsing, streaming, code source and copy.
 * The component map only supplies Nomi typography and local-first link/image policy. */
type MarkdownProfile = 'agent-v4'

/** The slice of the hast tree a fenced block exposes: `<pre><code class="language-x">text</code></pre>`. */
type FenceNode = { type?: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: FenceNode[] }

function fenceOf(pre: FenceNode | undefined): { language: string; source: string } {
  const code = pre?.children?.find((child) => child.type === 'element' && child.tagName === 'code')
  const classNames = Array.isArray(code?.properties?.className) ? code.properties.className.map(String) : []
  const language = classNames.find((name) => name.startsWith('language-'))?.slice('language-'.length) ?? ''
  const text = (node: FenceNode | undefined): string => node?.type === 'text' ? node.value ?? '' : (node?.children ?? []).map(text).join('')
  return { language, source: text(code) }
}

function makeComponents(compact: boolean, profile: MarkdownProfile | undefined, labels: MarkdownLabels): Components {
  const pMy = compact ? 'my-1' : 'my-2'
  const hMt = compact ? 'mt-2.5' : 'mt-4'
  const hMb = compact ? 'mb-1' : 'mb-2'
  const flat = profile === 'agent-v4'
  const h1 = compact ? 'text-title' : 'text-h2'
  const h2 = compact ? 'text-body' : 'text-title'
  const h3 = compact ? 'text-body-sm' : 'text-body'
  const bodyText = flat ? 'text-body-sm' : 'text-body'
  return {
    h1: ({ node: _n, ...p }) => <h1 className={`${h1} font-semibold leading-snug text-nomi-ink ${hMt} ${hMb} first:mt-0`} {...p} />,
    h2: ({ node: _n, ...p }) => <h2 className={`${h2} font-semibold leading-snug text-nomi-ink ${hMt} ${hMb} first:mt-0`} {...p} />,
    h3: ({ node: _n, ...p }) => <h3 className={`${h3} font-semibold leading-snug text-nomi-ink ${hMt} ${hMb} first:mt-0`} {...p} />,
    h4: ({ node: _n, ...p }) => <h4 className={`text-body-sm font-medium text-nomi-ink ${hMt} ${hMb}`} {...p} />,
    h5: ({ node: _n, ...p }) => <h5 className={`text-caption font-semibold text-nomi-ink ${hMt} ${hMb}`} {...p} />,
    h6: ({ node: _n, ...p }) => <h6 className={`text-caption font-medium text-nomi-ink-80 ${hMt} ${hMb}`} {...p} />,
    p: ({ node: _n, ...p }) => <p className={`${bodyText} leading-relaxed text-nomi-ink-80 ${pMy}`} {...p} />,
    ul: ({ node: _n, className, ...p }) => {
      const isTask = /contains-task-list/.test(className || '')
      return <ul className={`${isTask ? 'list-none pl-5' : 'list-disc pl-5'} ${pMy} ${bodyText} leading-relaxed text-nomi-ink-80`} {...p} />
    },
    ol: ({ node: _n, ...p }) => <ol className={`list-decimal pl-5 ${pMy} ${bodyText} leading-relaxed text-nomi-ink-80`} {...p} />,
    li: ({ node: _n, className, ...p }) => <li className={`my-0.5 ${/task-list-item/.test(className || '') ? 'list-none' : ''}`.trim()} {...p} />,
    a: ({ node: _n, children, href, ...p }) => {
      const external = Boolean(href && /^https?:\/\//i.test(href))
      const anchor = Boolean(href?.startsWith('#'))
      const destination = href?.startsWith('#user-content-') ? `#${labels.anchorPrefix}${href.slice('#user-content-'.length)}` : href
      if (!external && !anchor) return <span>{children}</span>
      return <a {...p} href={destination} onClick={anchor ? (event) => {
        // HashRouter owns location.hash; document references must scroll without navigation.
        event.preventDefault()
        document.getElementById(destination!.slice(1))?.scrollIntoView({ block: 'nearest' })
      } : undefined} className="text-nomi-accent underline underline-offset-2 [overflow-wrap:anywhere]" target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{children}{external && profile === 'agent-v4' ? <span aria-hidden="true" className="ml-0.5 no-underline">↗</span> : null}</a>
    },
    blockquote: ({ node: _n, ...p }) => <blockquote className={`border-l-2 border-nomi-line pl-3 ${pMy} text-nomi-ink-60`} {...p} />,
    hr: ({ node: _n, ...p }) => <hr className="border-nomi-line my-3" {...p} />,
    strong: ({ node: _n, ...p }) => <strong className="font-semibold text-nomi-ink" {...p} />,
    del: ({ node: _n, ...p }) => <del className="line-through text-nomi-ink-60" {...p} />,
    inlineCode: ({ node: _n, ...p }) => <code className="font-nomi-mono text-caption bg-nomi-ink-05 rounded-nomi-sm px-1 py-0.5 [overflow-wrap:anywhere]" {...p} />,
    // Do not request model-provided image URLs automatically. Preserve an explicit entry.
    img: ({ node: _n, alt, src }) => {
      const content = <><IconPhoto size={12} />{alt || labels?.imageLabel}</>
      const skin = 'inline-flex items-center gap-1 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 px-1.5 py-0.5 text-caption text-nomi-ink-60'
      return src && /^https?:\/\//i.test(src)
        ? <a className={skin} href={src} target="_blank" rel="noreferrer">{content}</a>
        : <span className={skin}>{content}</span>
    },
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
    // Same contract as Streamdown's own `pre` (mark the child as a block); additionally tag whether the fence
    // holds code or pasteable text, so the one skin below can pick the typeface. Rendering stays upstream.
    pre: ({ node, children }) => {
      if (!isValidElement(children)) return children
      const fence = fenceOf(node as FenceNode | undefined)
      const typeface = codeFenceTypeface(fence.language, fence.source, (language) => plugins.code?.supportsLanguage(language) ?? false)
      return cloneElement(children as ReactElement<Record<string, unknown>>, { 'data-block': 'true', 'data-nomi-code': typeface })
    },
  }
}

type MarkdownLabels = { imageLabel: string; anchorPrefix: string }

// Shiki keeps its tokenizer/cache; theme values follow the same Nomi tokens in both modes.
const theme = {
  // The code-block container owns the one surface; the highlighted body stays transparent on top of it.
  name: 'nomi', fg: 'var(--nomi-ink-80)', bg: 'transparent',
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: 'var(--nomi-ink-40)' } },
    { scope: ['keyword', 'storage'], settings: { foreground: 'var(--nomi-accent)' } },
    { scope: ['string'], settings: { foreground: 'var(--nomi-success)' } },
    { scope: ['constant.numeric', 'constant.language'], settings: { foreground: 'var(--nomi-warning)' } },
    { scope: ['entity.name.function', 'support.function'], settings: { foreground: 'var(--nomi-info-ink)' } },
  ],
}
const plugins: PluginConfig = { code: createCodePlugin({ themes: [theme, theme] }), cjk }
const controls = { code: { copy: true, download: false }, table: false, image: false }

export const NomiMarkdown = memo(function NomiMarkdown({
  children, compact = false, profile, streaming = false, copyLabel, imageLabel,
}: {
  children: string
  compact?: boolean
  profile?: MarkdownProfile
  streaming?: boolean
  copyLabel?: string
  imageLabel?: string
}): JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const components = useMemo(() => makeComponents(compact, profile, { imageLabel: imageLabel ?? t('agentPanelV4.image'), anchorPrefix: `nomi-${id}-` }), [compact, profile, imageLabel, id, t])
  const remarkRehypeOptions = useMemo(() => ({ clobberPrefix: `nomi-${id}-` }), [id])
  // Code-block skin: Streamdown ships a card (border + header + bordered action pill) around a second bordered
  // body. Nomi keeps one surface — the container — hides the language header, turns the action pill into a
  // 24px ghost icon pinned to the container's top-right corner, and wraps lines instead of scrolling sideways.
  // `data-nomi-code` (set by the `pre` adapter above) switches pasteable prose fences to the body typeface.
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <Streamdown components={components} plugins={plugins} controls={controls}
        mode="streaming" isAnimating={streaming} caret="block" parseIncompleteMarkdown={false}
        skipHtml remarkRehypeOptions={remarkRehypeOptions} lineNumbers={false}
        codeBlockMaxHeight={0} tableMaxHeight={0}
        translations={{ copyCode: copyLabel ?? t('agentPanelV4.copy'), copied: t('libraries.prompt.preview.copied') }}
        className="space-y-1 [&_[data-streamdown=code-block]]:my-2 [&_[data-streamdown=code-block]]:rounded-nomi-sm [&_[data-streamdown=code-block]]:relative [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block]]:border-nomi-line [&_[data-streamdown=code-block]]:bg-nomi-ink-05 [&_[data-streamdown=code-block]]:text-nomi-ink-80 [&_[data-streamdown=code-block-header]]:hidden [&_[data-streamdown=code-block]>div:has(>[data-streamdown=code-block-actions])]:top-1 [&_[data-streamdown=code-block]>div:has(>[data-streamdown=code-block-actions])]:mt-0 [&_[data-streamdown=code-block]>div:has(>[data-streamdown=code-block-actions])]:h-0 [&_[data-streamdown=code-block]>div:has(>[data-streamdown=code-block-actions])]:items-start [&_[data-streamdown=code-block-actions]]:m-1 [&_[data-streamdown=code-block-actions]]:border-0 [&_[data-streamdown=code-block-actions]]:bg-transparent [&_[data-streamdown=code-block-actions]]:p-0 [&_[data-streamdown=code-block-actions]]:[backdrop-filter:none] [&_[data-streamdown=code-block-copy-button]]:grid [&_[data-streamdown=code-block-copy-button]]:size-6 [&_[data-streamdown=code-block-copy-button]]:place-items-center [&_[data-streamdown=code-block-copy-button]]:rounded-nomi-sm [&_[data-streamdown=code-block-copy-button]]:p-0 [&_[data-streamdown=code-block-copy-button]]:text-nomi-ink-40 [&_[data-streamdown=code-block-copy-button]:hover]:bg-nomi-ink-10 [&_[data-streamdown=code-block-copy-button]:hover]:text-nomi-ink [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0 [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere] [&_pre]:py-2.5 [&_pre]:pl-3 [&_pre]:pr-8 [&_pre]:font-nomi-mono [&_pre]:text-caption [&_pre]:leading-relaxed [&_pre_code]:font-nomi-mono [&_[data-nomi-code=prose]_pre]:font-nomi-sans [&_[data-nomi-code=prose]_pre]:text-body-sm [&_[data-nomi-code=prose]_code]:font-nomi-sans">
        {children}
      </Streamdown>
    </div>
  )
})
