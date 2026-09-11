// agent-artifact 节点的内容分发内核（v1）。壳统一（BaseGenerationNode 的 kind 专属分支），
// 内层按 meta.artifact.fileType 挑子视图——浏览器按 MIME 挑应用的同款逻辑：
//   svg        → <img> 图片管线（DeferredNodeImage 同源，可缩放、棋盘格、加载态）
//   html       → 动态沙箱 iframe（无 same-origin；CSS 动效会跑，内联 JS 被宿主 CSP 拦，见 §6.5）
//   markdown   → 轻量 Markdown 渲染（行内样式自包含，不引新依赖；P1 换 NomiMarkdown 或复用）
//   table      → HTML 表格渲染（产物是 Markdown 表格先由 Agent 转 HTML；此处直渲 table HTML）
//   text       → 等宽文本展示（可复制）
//   glb        → 复用 Model3DViewer（R3F useGLTF，scene3d 同栈；懒加载避免拖慢首屏）
//
// 安全：code/text/markdown 只展示不执行；html 是唯一"活内容"，在沙箱内跑。
// 产物文件一律 nomi-local:// 落盘引用（meta.artifact.url 带真实扩展名），节点不塞内联源码。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCode, IconCube, IconFileText, IconInfoCircle, IconMarkdown, IconTable, IconVector } from '@tabler/icons-react'
import { lazyWithChunkBoundary } from '../../../../ui/chunkBoundary'
import { cn } from '../../../../utils/cn'
import type { AgentArtifactMeta, ArtifactFileType } from '../../model/artifactMeta'
import { withArtifactSandboxPolicy } from './artifactSandboxDocument'
import { NomiMarkdown } from '../../../common/NomiMarkdown'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { NODE_SCROLL_REGION_CLASS_NAME } from '../nodeScrollRegionClassName'

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
  // 渲染，不是把源码贴出来。Markdown 产物是给人读的备注/脚本——留着 `# ` `- ` 一堆记号
  // 等于把「已经排好版的东西」退回原材料。NomiMarkdown 是全仓唯一的 Markdown 渲染器
  // （token 化、带 GFM 表格），compact 档正是给这种窄容器用的。
  return (
    <div className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'h-full w-full overflow-auto bg-nomi-paper px-3 py-2.5 select-text cursor-text')}>
      <NomiMarkdown compact>{markdown}</NomiMarkdown>
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
    <div className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'h-full w-full overflow-auto bg-nomi-paper px-3 py-2.5 select-text cursor-text')}>
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
    <pre className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'h-full w-full overflow-auto bg-nomi-ink-05 px-3 py-2.5 text-body-sm text-nomi-ink-80 font-mono whitespace-pre-wrap break-words select-text cursor-text')}>
      {text}
    </pre>
  )
}

/** 产物类型 → 角标图标。图标说的是「这是什么做的」，和 chip 文本一起给出类型身份。 */
const ARTIFACT_TYPE_ICON: Record<ArtifactFileType, typeof IconCode> = {
  svg: IconVector,
  html: IconCode,
  markdown: IconMarkdown,
  table: IconTable,
  text: IconFileText,
  glb: IconCube,
}

/** 常驻头部：类型角标 + 标题（样张 §「画布上的手艺产物」的 n-head）。
 *  为什么必须常驻：一张 SVG 线稿和一张生图在画布上长得一样大、一样是图——
 *  没有角标，用户分不出「这是 Agent 手画的、可以固化成参考图」还是「这是模型生成的画面」；
 *  没有标题，一批产物落下来只能靠内容认。两者都不是装饰，是身份。 */
function ArtifactHeader({ fileType, title }: { fileType: ArtifactFileType; title: string }): JSX.Element {
  const { t } = useTranslation()
  const Icon = ARTIFACT_TYPE_ICON[fileType]
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 border-b border-nomi-line-soft bg-nomi-paper px-2 py-1"
      data-artifact-head="true"
    >
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-nomi-accent-soft px-1.5 py-0.5 text-caption font-medium text-nomi-accent"
        data-artifact-kindchip="true"
      >
        <Icon size={11} stroke={1.8} />
        {t(`runtime.nodeRegistry.agent-artifact.fileType.${fileType}`)}
      </span>
      <span className="min-w-0 flex-1 truncate text-caption font-medium text-nomi-ink-80" data-artifact-title="true">
        {title || t('runtime.nodeRegistry.agent-artifact.untitled')}
      </span>
    </div>
  )
}

/** HTML 产物的诚实标注（2026-09-07 用户拍板：按现状合并，界面上明标「暂不支持交互」）。
 *
 *  为什么必须写在卡面上：HTML 产物的 CSS 是真的在跑（@keyframes / transition / :hover 全生效），
 *  所以这张卡**看起来是活的**——用户的下一个动作就是伸手去点它，然后什么都不发生。
 *  缺口是规范决定的、不是实现没写好：产物走 srcdoc（跨源隔离下 iframe src 一律被拦），
 *  srcdoc 继承宿主 CSP，而宿主 `script-src` 没有 'unsafe-inline' → 产物内联脚本不执行
 *  （方案 §6.5 三条约束互相咬死）。在「产物走独立 WebContentsView」那一刀落地之前，
 *  唯一诚实的做法是把限制标在用户眼前（D4：缺口明着标，不藏不糊弄）。
 *
 *  只对 html 出现：svg/markdown/table/text/glb 本来就不是"活内容"，给它们标同一句是噪音。
 *  形态上是一条静态说明带，不是控件——不新增 §1.5 的控件层级，动作仍然只在选中浮条里。
 */
function ArtifactInteractionNote(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="flex shrink-0 items-center gap-1 border-t border-nomi-line-soft bg-nomi-paper px-2 py-0.5 text-caption text-nomi-ink-40"
      data-artifact-interaction-note="true"
    >
      <IconInfoCircle size={11} stroke={1.8} className="shrink-0" />
      <span className="min-w-0 truncate">{t('runtime.nodeRegistry.agent-artifact.htmlInteractionNote')}</span>
    </div>
  )
}

/** 按 fileType 挑子视图。壳（头部/边框/尺寸）统一在 ArtifactBody，这里只管内容。 */
function ArtifactContent({ node, artifact }: { node: GenerationCanvasNode; artifact: AgentArtifactMeta }): JSX.Element {
  const { url, fileType } = artifact
  switch (fileType) {
    case 'svg':
      return (
        <img
          src={url}
          alt={node.title || ''}
          className="h-full w-full object-contain select-none bg-nomi-ink-05"
          draggable={false}
        />
      )
    case 'html':
      return <HtmlSandbox url={url} title={node.title || ''} />
    case 'markdown':
      return <MarkdownPreview url={url} />
    case 'table':
      return <TablePreview url={url} />
    case 'text':
      return <TextPreview url={url} />
    case 'glb':
      return (
        <React.Suspense fallback={<div className="h-full w-full bg-nomi-ink-05 animate-pulse" />}>
          <Model3DViewer url={url} />
        </React.Suspense>
      )
    default:
      return <div className="h-full w-full flex items-center justify-center text-nomi-ink-40 text-body-sm">—</div>
  }
}

/** 内容分发内核：一个壳（头部 + 内容），按 fileType 挑子视图。 */
export default function ArtifactBody({ node, artifact, width, height }: ArtifactBodyProps): JSX.Element {
  return (
    <div
      className={cn('flex h-full w-full flex-col overflow-hidden rounded-nomi ring-1 ring-inset ring-nomi-line-soft bg-nomi-paper')}
      style={{ width, height }}
      data-artifact-file-type={artifact.fileType}
    >
      <ArtifactHeader fileType={artifact.fileType} title={node.title || ''} />
      <div className="min-h-0 flex-1 overflow-hidden" data-artifact-content="true">
        <ArtifactContent node={node} artifact={artifact} />
      </div>
      {artifact.fileType === 'html' ? <ArtifactInteractionNote /> : null}
    </div>
  )
}

/** HTML 产物沙箱（决策 3：把活内容关进笼子）。当前只有 CSS 会动，内联 JS 不执行——
 *  卡面上由 ArtifactInteractionNote 明标，别在别处写成「能交互」。
 *
 *  产物文本先取回来，再以 `srcdoc` 交给沙箱 iframe，策略随文档注入（artifactSandboxDocument）。
 *  **不能**直接 `src="nomi-local://…"`：主窗跨源隔离下，跨源文档一律不能当 frame 加载
 *  （真机 ERR_BLOCKED_BY_RESPONSE，补 COEP 也救不回来），表现就是一块白板。详见该模块头注。
 *
 *  `sandbox="allow-scripts"`（**无** allow-same-origin）：origin 仍是 opaque(null)，
 *  产物脚本读不到宿主 DOM/storage，也没有 top-navigation / popups / forms。
 */
function HtmlSandbox({ url, title }: { url: string; title: string }): JSX.Element {
  const [sandboxDoc, setSandboxDoc] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    setSandboxDoc(null)
    fetch(url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((text) => {
        if (!cancelled) setSandboxDoc(withArtifactSandboxPolicy(text))
      })
      .catch(() => {
        if (!cancelled) setSandboxDoc('')
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (sandboxDoc === null) return <div className="h-full w-full bg-nomi-ink-05 animate-pulse" />
  return (
    <iframe
      key={url}
      srcDoc={sandboxDoc}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="h-full w-full border-0 bg-nomi-paper"
    />
  )
}
