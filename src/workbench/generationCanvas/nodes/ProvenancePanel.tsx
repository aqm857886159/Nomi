import React from 'react'
import type { GenerationCanvasNode, GenerationProvenance } from '../model/generationCanvasTypes'
import { cn } from '../../../utils/cn'

/**
 * Phase E Task E11 — Provenance viewer.
 *
 * Displays full generation provenance for a node's current result so the
 * user can: see why this looks the way it does, copy the exact prompt, or
 * "regenerate with the same params" (button delegated to caller via
 * onRegenerate). Falls back to a friendly "no provenance recorded" message
 * for legacy v0.4.0 nodes that predate E11.
 */

type Props = {
  node: GenerationCanvasNode
  open: boolean
  onClose: () => void
  /** Optional regenerate handler — if absent, button is hidden. */
  onRegenerate?: (provenance: GenerationProvenance) => void
}

function copyToClipboard(text: string): void {
  if (!text) return
  try { void navigator.clipboard?.writeText(text) } catch { /* ignore */ }
}

export default function ProvenancePanel({ node, open, onClose, onRegenerate }: Props): JSX.Element | null {
  if (!open) return null
  const provenance = node.result?.provenance
  return (
    <div
      className="fixed inset-0 z-[210] grid place-items-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="生成 Provenance"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full max-w-[560px] max-h-[80vh] overflow-y-auto',
          'bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-md p-5',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-title font-medium text-nomi-ink m-0">生成记录 · {node.title || node.kind}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-nomi-ink-40 hover:text-nomi-ink text-h2 leading-none"
            aria-label="关闭"
          >×</button>
        </div>

        {!provenance ? (
          <div className="text-body-sm text-nomi-ink-40 leading-relaxed">
            该节点没有可追溯的生成记录。
            <div className="mt-2 text-caption">
              可能原因：
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                <li>节点来自 v0.4.0 之前的旧项目（Provenance 是 v0.5 新增能力）</li>
                <li>素材为本地导入，非 AI 生成</li>
                <li>生成调用失败，未写入 Provenance</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-caption">
            <ProvenanceRow label="供应商" value={provenance.provider || '—'} />
            <ProvenanceRow label="模型" value={provenance.modelKey || '—'} />
            <ProvenanceRow label="时间" value={new Date(provenance.timestamp).toLocaleString('zh-CN')} />
            {typeof provenance.seed === 'number' ? (
              <ProvenanceRow label="Seed" value={String(provenance.seed)} mono />
            ) : null}
            <div>
              <div className="text-micro text-nomi-ink-40 uppercase tracking-wide mb-1">Prompt</div>
              <div className="bg-nomi-bg border border-nomi-line-soft rounded-nomi-sm p-2 text-caption font-mono leading-relaxed whitespace-pre-wrap break-words text-nomi-ink-80">
                {provenance.prompt || '(空)'}
              </div>
              {provenance.prompt ? (
                <button
                  type="button"
                  onClick={() => copyToClipboard(provenance.prompt || '')}
                  className="mt-1 text-micro text-nomi-accent hover:underline"
                >
                  复制 Prompt
                </button>
              ) : null}
            </div>
            {provenance.negativePrompt ? (
              <div>
                <div className="text-micro text-nomi-ink-40 uppercase tracking-wide mb-1">Negative Prompt</div>
                <div className="bg-nomi-bg border border-nomi-line-soft rounded-nomi-sm p-2 text-caption font-mono">
                  {provenance.negativePrompt}
                </div>
              </div>
            ) : null}
            {provenance.params && Object.keys(provenance.params).length > 0 ? (
              <div>
                <div className="text-micro text-nomi-ink-40 uppercase tracking-wide mb-1">参数</div>
                <pre className="bg-nomi-bg border border-nomi-line-soft rounded-nomi-sm p-2 text-micro font-mono overflow-x-auto text-nomi-ink-80">
{JSON.stringify(provenance.params, null, 2)}
                </pre>
              </div>
            ) : null}
            {provenance.vendorRequestId ? (
              <ProvenanceRow label="Vendor Request ID" value={provenance.vendorRequestId} mono small />
            ) : null}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-nomi-line-soft">
          {provenance && onRegenerate ? (
            <button
              type="button"
              onClick={() => onRegenerate(provenance)}
              className={cn(
                'px-3 py-1.5 rounded-nomi-sm text-caption',
                'bg-nomi-accent text-white hover:opacity-90',
                'transition-opacity duration-150',
              )}
            >
              用相同参数重生成
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-nomi-sm text-caption border border-nomi-line text-nomi-ink-80 hover:bg-nomi-bg"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

function ProvenanceRow({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }): JSX.Element {
  return (
    <div className="flex items-baseline gap-3">
      <div className={cn(
        'text-nomi-ink-40 shrink-0 w-[80px] text-micro',
      )}>{label}</div>
      <div className={cn(
        'flex-1 text-nomi-ink-80',
        mono ? 'font-mono' : '',
        small ? 'text-micro' : 'text-caption',
        'break-words',
      )}>{value}</div>
    </div>
  )
}
