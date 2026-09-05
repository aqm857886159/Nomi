import React from 'react'
import { IconChevronRight, IconCopy, IconPaperclip } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import type { V4ToolStatus } from '../agentPanelV4Types'

/**
 * React 18/Tailwind 3 adaptation of the current AI Elements anatomy.
 * These are intentionally presentational: Nomi owns state, tokens and icons;
 * a future wiring pass can replace fixture children without changing layout.
 */
export function Message({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }): JSX.Element {
  return <article className={cn('text-micro leading-relaxed', role === 'user' ? 'ml-auto max-w-[88%] rounded-nomi bg-nomi-ink px-3 py-2 text-nomi-paper' : 'text-nomi-ink')} data-ai-element="message" data-role={role}>{children}</article>
}

export function MessageResponse({ children, streaming = false }: { children: React.ReactNode; streaming?: boolean }): JSX.Element {
  return <div data-ai-element="response">{children}{streaming ? <span aria-hidden="true" className="ml-0.5 inline-block h-3 w-1.5 rounded-sm bg-nomi-ink-30 align-[-2px]" /> : null}</div>
}

export function MessageActions({ onCopy, children, copyLabel = 'Copy' }: { onCopy?: () => void; children?: React.ReactNode; copyLabel?: string }): JSX.Element {
  return <div className="mt-1 flex items-center gap-1 text-nomi-ink-40" data-ai-element="actions"><button type="button" aria-label={copyLabel} onClick={onCopy} className="grid size-5 place-items-center rounded-nomi-sm hover:bg-nomi-ink-05"><IconCopy size={12} /></button>{children}</div>
}

export function Tool({ title, status, children, open = false }: { title: string; status: V4ToolStatus; children?: React.ReactNode; open?: boolean }): JSX.Element {
  return <details open={open} className="rounded-nomi-sm border border-nomi-line-soft" data-ai-element="tool" data-status={status}><summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 px-2 text-micro text-nomi-ink-60"><IconChevronRight size={12} className="transition-transform [details[open]_&]:rotate-90" /><span className="font-medium text-nomi-ink">{title}</span><span className="ml-auto text-nomi-ink-40">{status}</span></summary>{children ? <div className="space-y-2 border-t border-nomi-line-soft p-2 text-micro" data-ai-element="tool-content">{children}</div> : null}</details>
}

export function ToolInput({ value, label = 'Input' }: { value: React.ReactNode; label?: string }): JSX.Element {
  return <div data-ai-element="tool-input"><div className="mb-1 text-nano uppercase tracking-wide text-nomi-ink-40">{label}</div><pre className="m-0 overflow-x-auto rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-nano text-nomi-ink-80">{value}</pre></div>
}

export function ToolOutput({ value, error, outputLabel = 'Output', errorLabel = 'Error' }: { value?: React.ReactNode; error?: string; outputLabel?: string; errorLabel?: string }): JSX.Element | null {
  if (!value && !error) return null
  return <div data-ai-element="tool-output"><div className="mb-1 text-nano uppercase tracking-wide text-nomi-ink-40">{error ? errorLabel : outputLabel}</div><div className={cn('rounded-nomi-sm p-2 text-nano', error ? 'bg-nomi-danger-soft text-workbench-danger' : 'bg-nomi-ink-05 text-nomi-ink-80')}>{error ?? value}</div></div>
}

export function Task({ title, status, children }: { title: string; status: string; children?: React.ReactNode }): JSX.Element {
  return <section className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper" data-ai-element="task" data-status={status}><header className="flex items-center gap-2 border-b border-nomi-line-soft bg-nomi-ink-05 px-2.5 py-2 text-micro"><strong>{title}</strong><span className="ml-auto text-nomi-ink-40">{status}</span></header>{children ? <div className="grid gap-1.5 px-2.5 py-2">{children}</div> : null}</section>
}

export function Confirmation({ title, summary, children }: { title: string; summary: string; children?: React.ReactNode }): JSX.Element {
  return <aside className="overflow-hidden rounded-nomi border border-nomi-accent bg-nomi-paper" data-ai-element="confirmation"><header className="bg-nomi-accent-soft px-2.5 py-2 text-micro font-semibold text-nomi-accent">{title}</header><div className="px-2.5 py-2 text-micro text-nomi-ink">{summary}</div>{children ? <footer className="border-t border-nomi-line-soft px-2.5 py-1.5">{children}</footer> : null}</aside>
}

export function Plan({ items }: { items: readonly string[] }): JSX.Element {
  return <div className="grid gap-1" data-ai-element="plan">{items.map((item) => <label key={item} className="flex items-center gap-1.5 text-micro"><input type="checkbox" defaultChecked />{item}</label>)}</div>
}

export function Queue({ items, runningLabel = 'running', queuedLabel = 'queued' }: { items: readonly string[]; runningLabel?: string; queuedLabel?: string }): JSX.Element {
  return <div className="grid gap-1 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 p-2 text-micro" data-ai-element="queue">{items.map((item, index) => <div key={item} className="flex items-center gap-2"><span className={cn('size-1.5 rounded-pill bg-nomi-ink-30', index === 0 && 'bg-nomi-accent')} />{item}<span className="ml-auto text-nomi-ink-40">{index === 0 ? runningLabel : queuedLabel}</span></div>)}</div>
}

export function PromptInput({ value, onChange, placeholder, onSubmit, toolsLabel = 'Tools', submitLabel = 'Send' }: { value: string; onChange: (value: string) => void; placeholder: string; onSubmit: () => void; toolsLabel?: string; submitLabel?: string }): JSX.Element {
  return <form className="rounded-nomi border border-nomi-line bg-nomi-paper p-2" data-ai-element="prompt-input" onSubmit={(event) => { event.preventDefault(); onSubmit() }}><textarea rows={1} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-0 w-full resize-none bg-transparent text-micro outline-none" /><div className="flex items-center gap-1 text-micro text-nomi-ink-60"><IconPaperclip size={14} /><span>{toolsLabel}</span><button type="submit" className="ml-auto rounded-nomi-sm bg-nomi-ink px-2 py-1 text-nomi-paper">{submitLabel}</button></div></form>
}

export function ModelSelector({ model }: { model: string }): JSX.Element {
  return <button type="button" className="inline-flex items-center rounded-nomi-sm px-1.5 py-1 text-micro text-nomi-ink-80" data-ai-element="model-selector">{model}</button>
}

export function Attachments({ names }: { names: readonly string[] }): JSX.Element {
  return <div className="flex flex-wrap gap-1" data-ai-element="attachments">{names.map((name) => <span key={name} className="inline-flex items-center gap-1 rounded-nomi-sm border border-nomi-line px-1.5 py-0.5 text-micro"><IconPaperclip size={12} />{name}</span>)}</div>
}
