import React from 'react'
import { createPortal } from 'react-dom'
import { IconX, IconExternalLink } from '@tabler/icons-react'
import type { WorkspaceFileNode } from '../../../electron/workspace/workspaceFileIndex'
import { getDesktopBridge } from '../../desktop/bridge'
import { NomiMarkdown } from '../common/NomiMarkdown'
import { useFilePreviewStore } from './useFilePreviewStore'
import { buildWorkspaceFileUrl } from './workspaceFileDrag'

/**
 * Right-side file preview panel (singleton). Lets users glance at an imported
 * file's content without leaving the canvas (the whole point — a center modal
 * would cover the work). Content is served by the privileged `nomi-local://`
 * protocol, so text is fetched and PDFs/images load directly; no new IPC.
 */
export function FilePreviewPanel(): JSX.Element | null {
  const open = useFilePreviewStore((s) => s.open)
  const projectId = useFilePreviewStore((s) => s.projectId)
  const node = useFilePreviewStore((s) => s.node)
  const close = useFilePreviewStore((s) => s.close)
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey)
    // Defer the outside-click listener so the click that opened it doesn't close it.
    const t = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
      window.clearTimeout(t)
    }
  }, [open, close])

  if (!open || !node) return null
  const url = buildWorkspaceFileUrl(projectId, node.relativePath)
  const reveal = () => getDesktopBridge()?.workspace?.revealFile?.({ projectId, relativePath: node.relativePath })

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`预览 ${node.name}`}
      className="bg-nomi-paper shadow-nomi-lg border-l border-nomi-line flex flex-col"
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, zIndex: 4000 }}
    >
      <div className="flex items-center gap-1 px-3 border-b border-nomi-line shrink-0" style={{ height: 44 }}>
        <span className="flex-1 truncate text-body text-nomi-ink" title={node.relativePath}>{node.name}</span>
        <button type="button" onClick={reveal} title="在 Finder 打开" className="p-1 text-nomi-ink-60 hover:text-nomi-ink">
          <IconExternalLink size={16} stroke={1.6} />
        </button>
        <button type="button" onClick={close} aria-label="关闭" className="p-1 text-nomi-ink-60 hover:text-nomi-ink">
          <IconX size={16} stroke={1.6} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3">
        <PreviewBody node={node} url={url} />
      </div>
    </div>,
    document.body,
  )
}

function PreviewBody({ node, url }: { node: WorkspaceFileNode; url: string }): JSX.Element {
  switch (node.kind) {
    case 'image':
      return <img src={url} alt={node.name} className="mx-auto max-w-full object-contain" />
    case 'video':
      return <video src={url} controls className="w-full" />
    case 'audio':
      return <audio src={url} controls className="w-full" />
    case 'document': // pdf → Chromium's built-in viewer
      return <iframe src={url} title={node.name} className="w-full border-0" style={{ height: '100%', minHeight: '70vh' }} />
    case 'text':
      return <TextPreview url={url} markdown={node.contentType === 'text/markdown'} />
    default:
      return (
        <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
          <span className="text-body-sm text-nomi-ink-60">这种格式暂不支持预览</span>
          <span className="text-caption text-nomi-ink-40">用上方「在 Finder 打开」查看</span>
        </div>
      )
  }
}

function TextPreview({ url, markdown }: { url: string; markdown: boolean }): JSX.Element {
  const [state, setState] = React.useState<{ loading: boolean; text: string; error: string }>({ loading: true, text: '', error: '' })
  React.useEffect(() => {
    let alive = true
    setState({ loading: true, text: '', error: '' })
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text() })
      .then((t) => { if (alive) setState({ loading: false, text: t.slice(0, 500_000), error: '' }) })
      .catch((e) => { if (alive) setState({ loading: false, text: '', error: e instanceof Error ? e.message : String(e) }) })
    return () => { alive = false }
  }, [url])

  if (state.loading) return <div className="text-body-sm text-nomi-ink-40">加载中…</div>
  if (state.error) return <div className="text-body-sm text-workbench-danger">读取失败：{state.error}</div>
  if (markdown) return <NomiMarkdown>{state.text}</NomiMarkdown>
  return <pre className="whitespace-pre-wrap break-words font-nomi-mono text-caption leading-relaxed text-nomi-ink-80">{state.text}</pre>
}
