// agent-artifact 节点的内容分发内核（v1）。壳统一（BaseGenerationNode 的 kind 专属分支），
// 内层按 meta.artifact.fileType 挑子视图——浏览器按 MIME 挑应用的同款逻辑：
//   svg        → <img> 图片管线（DeferredNodeImage 同源，可缩放、棋盘格、加载态）
//   html       → 动态沙箱 iframe（allow-scripts、无 same-origin；会动会交互但不碰宿主）
//   markdown   → 轻量 Markdown 渲染（行内样式自包含，不引新依赖；P1 换 NomiMarkdown 或复用）
//   table      → HTML 表格渲染（产物是 Markdown 表格先由 Agent 转 HTML；此处直渲 table HTML）
//   text       → 等宽文本展示（可复制）
//   glb        → 复用 Model3DViewer（R3F useGLTF，scene3d 同栈；懒加载避免拖慢首屏）
//
// 安全：code/text/markdown 只展示不执行；html 是唯一"活内容"，在沙箱内跑。
// 产物文件一律 nomi-local:// 落盘引用（meta.artifact.url 带真实扩展名），节点不塞内联源码。
import React from 'react'
import { lazyWithChunkBoundary } from '../../../../ui/chunkBoundary'
import { cn } from '../../../../utils/cn'
import type { AgentArtifactMeta } from '../../model/artifactMeta'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'

const Model3DViewer = lazyWithChunkBoundary('3D 模型预览', () => import('../model3d/Model3DViewer'))

export type ArtifactBodyProps = {
  node: GenerationCanvasNode
  artifact: AgentArtifactMeta
  width: number
  height: number
}

function MarkdownPreview({ url }: { url: string }): JSX.Element {
  const [markdown, setMarkdown] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    setMarkdown(null)
    fetch(url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((text) => {
        if (!cancelled) setMarkdown(text)
      })
      .catch(() => {
        if (!cancelled) setMarkdown('')
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (markdown === null) {
    return <div className="h-full w-full bg-nomi-ink-05 animate-pulse" />
  }
  return (
    <div className="h-full w-full overflow-auto bg-nomi-paper px-3 py-2.5 text-body-sm text-nomi-ink-80 whitespace-pre-wrap break-words font-sans select-text cursor-text">
      {markdown}
    </div>
  )
}

function TablePreview({ url }: { url: string }): JSX.Element {
  const [tableHtml, setTableHtml] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    setTableHtml(null)
    fetch(url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((text) => {
        if (!cancelled) setTableHtml(text)
      })
      .catch(() => {
        if (!cancelled) setTableHtml('')
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (tableHtml === null) {
    return <div className="h-full w-full bg-nomi-ink-05 animate-pulse" />
  }
  // 注意：表格产物由 Agent 生成、只含结构化表格 HTML（无脚本）——仍走 React 解析而非 dangerouslySetInnerHTML，
  // 从源头避免把任意 HTML 当代码执行（安全原则：可执行内容只在 HtmlSandbox 的沙箱里碰）。
  return (
    <div className="h-full w-full overflow-auto bg-nomi-paper px-3 py-2.5 select-text cursor-text">
      <div className="w-fit min-w-full">
        <TableView html={tableHtml} />
      </div>
    </div>
  )
}

/** 结构化表格 HTML 的安全渲染：只认识 <table>/<thead>/<tbody>/<tr>/<th>/<td>，其它标签剥掉。 */
function TableView({ html }: { html: string }): JSX.Element {
  const rows = React.useMemo(() => extractTableRows(html), [html])
  if (rows.length === 0) return <div className="text-nomi-ink-40 text-body-sm">—</div>
  return (
    <table className="border-collapse text-body-sm">
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-b border-nomi-line-soft">
            {row.map((cell, cellIndex) => {
              const isHeader = rowIndex === 0 || row[0] === ''
              return (
                <td
                  key={cellIndex}
                  className={cn(
                    'border border-nomi-line px-2 py-1 align-top',
                    isHeader ? 'font-medium text-nomi-ink-80 bg-nomi-ink-05' : 'text-nomi-ink-80',
                  )}
                >
                  {cell}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 极简 table HTML → 行/格文本（够 Agent 梳理型表格用；不做完整 HTML 表格解析器）。 */
function extractTableRows(html: string): string[][] {
  const fragment = html.trim()
  if (!fragment) return []
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<table>${fragment}</table>`, 'text/html')
  const rows: string[][] = []
  doc.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = []
    tr.querySelectorAll('th, td').forEach((cell) => cells.push((cell.textContent || '').trim()))
    if (cells.length > 0) rows.push(cells)
  })
  return rows
}

function TextPreview({ url }: { url: string }): JSX.Element {
  const [text, setText] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    setText(null)
    fetch(url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((value) => {
        if (!cancelled) setText(value)
      })
      .catch(() => {
        if (!cancelled) setText('')
      })
    return () => {
      cancelled = true
    }
  }, [url])
  if (text === null) return <div className="h-full w-full bg-nomi-ink-05 animate-pulse" />
  return (
    <pre className="h-full w-full overflow-auto bg-nomi-ink-05 px-3 py-2.5 text-body-sm text-nomi-ink-80 font-mono whitespace-pre-wrap break-words select-text cursor-text">
      {text}
    </pre>
  )
}

/** 内容分发内核：一个壳，按 fileType 挑子视图。 */
export default function ArtifactBody({ node, artifact, width, height }: ArtifactBodyProps): JSX.Element {
  const { url, fileType } = artifact
  const common = cn('h-full w-full overflow-hidden rounded-nomi ring-1 ring-inset ring-nomi-line-soft bg-nomi-paper')
  const style = { width, height }

  switch (fileType) {
    case 'svg':
      return (
        <div className={common} style={style}>
          <img
            src={url}
            alt={node.title || ''}
            className="h-full w-full object-contain select-none bg-nomi-ink-05"
            draggable={false}
          />
        </div>
      )
    case 'html':
      return (
        <div className={common} style={style}>
          <HtmlSandbox url={url} title={node.title || ''} />
        </div>
      )
    case 'markdown':
      return (
        <div className={common} style={style}>
          <MarkdownPreview url={url} />
        </div>
      )
    case 'table':
      return (
        <div className={common} style={style}>
          <TablePreview url={url} />
        </div>
      )
    case 'text':
      return (
        <div className={common} style={style}>
          <TextPreview url={url} />
        </div>
      )
    case 'glb':
      return (
        <div className={common} style={style}>
          <React.Suspense fallback={<div className="h-full w-full bg-nomi-ink-05 animate-pulse" />}>
            <Model3DViewer url={url} />
          </React.Suspense>
        </div>
      )
    default:
      return <div className="h-full w-full flex items-center justify-center text-nomi-ink-40 text-body-sm">—</div>
  }
}

/** HTML 产物沙箱（决策 3：会动会交互，但关进笼子）。
 *  - sandbox="allow-scripts"（无 allow-same-origin）：脚本能跑动画/交互，但拿不到宿主 origin/存储/顶层 DOM；
 *  - Electron 侧本窗口无 nodeIntegration + contextIsolation，iframe 继承该隔离且被 sandbox 再压一层；
 *  - 产物经 nomi-local:// 只读自己的资源；宿主不向其暴露任何 preload/IPC。
 *  - 兜底注释：真正需要宿主能力的 HTML（P1）改走独立 WebContentsView/session，不放开本沙箱。
 */
function HtmlSandbox({ url, title }: { url: string; title: string }): JSX.Element {
  return (
    <iframe
      key={url}
      src={url}
      title={title}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-nomi-paper"
      loading="lazy"
    />
  )
}
