import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { V4Intervention, V4Queue, V4TaskCard, V4ToolReceipt, V4UserBubble } from './AgentPanelV4Primitives'

const toolStatuses = ['input-streaming', 'input-available', 'approval-requested', 'approval-responded', 'output-available', 'output-denied', 'output-error'] as const
const taskStatuses = ['queued', 'running', 'complete', 'failed', 'stopped'] as const
const labels = { status: { queued: '排队', running: '生成中', complete: '完成', failed: '失败', stopped: '已停止' }, adopt: '采用', undo: '撤销' }
const interventionKinds = ['approval-irreversible', 'approval-reversible', 'reject-reason', 'spend', 'question', 'plan', 'credential', 'deviation'] as const

describe('agent panel v4 building blocks', () => {
  it('renders a user attachment chip', () => expect(renderToString(React.createElement(V4UserBubble, { text: 'hello', attachment: 'ref.png' }))).toContain('ref.png'))
  it.each(toolStatuses)('renders tool status %s', (status) => expect(renderToString(React.createElement(V4ToolReceipt, { receipt: { label: 'read', action: 'timeline', status }, statusLabel: '状态' }))).toContain(`data-status="${status}"`))
  it.each(taskStatuses)('renders task status %s', (status) => expect(renderToString(React.createElement(V4TaskCard, { task: { title: '生成', status }, labels }))).toContain(`data-status="${status}"`))
  it.each(interventionKinds)('renders intervention kind %s', (kind) => expect(renderToString(React.createElement(V4Intervention, { data: { kind, title: '介入', summary: '确认' }, labels: { confirm: '确认', reject: '不要', escalate: '不再问 →', cancel: '取消' } }))).toContain(`data-kind="${kind}"`))
  it('renders queue rows as a stable block', () => expect(renderToString(React.createElement(V4Queue, { rows: [{ title: 'timeline', status: 'running' }, { title: 'images', status: 'queued' }, { title: 'done', status: 'complete' }], labels: { queued: '排队', running: '进行中', complete: '完成', remove: '删除' } }))).toContain('data-v4-block="queue"'))
})
