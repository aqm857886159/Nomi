/**
 * OnboardingWizard 的支撑模块：milestone 数据 + 纯函数 + 无状态展示子组件。
 * 与向导主体分离（R9 防巨壳），不含任何 wizard state。
 */
import React from 'react'
import { Group, Stack, Text } from '@mantine/core'
import { IconCheck, IconX } from '@tabler/icons-react'

export type Milestone = {
  id: 'read' | 'kind' | 'identity' | 'fields' | 'test' | 'commit'
  label: string
  status: 'pending' | 'active' | 'done' | 'failed'
}

export const INITIAL_MILESTONES: Milestone[] = [
  { id: 'read', label: '读取文档内容', status: 'pending' },
  { id: 'kind', label: '识别类型', status: 'pending' },
  { id: 'identity', label: '识别接口和认证方式', status: 'pending' },
  { id: 'fields', label: '提取参数', status: 'pending' },
  { id: 'test', label: '测试调用', status: 'pending' },
  { id: 'commit', label: '保存到模型库', status: 'pending' },
]

export const MILESTONE_BY_TOOL: Record<string, Milestone['id']> = {
  fetch_raw_docs: 'read',
  set_model_kind: 'kind',
  set_vendor_info: 'identity',
  set_fields: 'fields',
  add_field_with_evidence: 'fields',
  set_mapping_request: 'identity',
  set_mapping_response: 'identity',
  execute_test_curl: 'test',
  commit_model: 'commit',
  check_completeness: 'fields',
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <Stack gap={4}>
      <Text size="sm" c="var(--nomi-ink)">{label}</Text>
      {children}
      {hint && <Text size="xs" c="var(--nomi-ink-60)">{hint}</Text>}
    </Stack>
  )
}

export function MilestoneRow({ milestone, detail }: { milestone: Milestone; detail?: string }): JSX.Element {
  const color = milestone.status === 'pending' ? 'var(--nomi-ink-40)' : 'var(--nomi-ink-80)'
  return (
    <Group gap={8} wrap="nowrap" align="center" justify="space-between">
      <Text size="sm" c={color}>{detail || milestone.label}</Text>
      <span className="inline-flex items-center justify-center" style={{ width: 14 }}>
        {milestone.status === 'done' ? (
          <IconCheck size={14} stroke={1.8} color="var(--workbench-success)" />
        ) : milestone.status === 'failed' ? (
          <IconX size={14} stroke={1.8} color="var(--workbench-danger)" />
        ) : (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: milestone.status === 'active' ? 'var(--nomi-accent)' : 'var(--nomi-ink-20)',
          }} />
        )}
      </span>
    </Group>
  )
}

export function bumpToActive(milestones: Milestone[], id: Milestone['id']): Milestone[] {
  return milestones.map(m =>
    m.id === id ? { ...m, status: m.status === 'pending' ? 'active' : m.status } : m,
  )
}

export function markStatus(milestones: Milestone[], id: Milestone['id'], status: Milestone['status']): Milestone[] {
  return milestones.map(m => m.id === id ? { ...m, status } : m)
}

export function activeMessageFor(id: Milestone['id']): string {
  switch (id) {
    case 'read': return '正在阅读文档…'
    case 'kind': return '正在识别模型类型…'
    case 'identity': return '正在识别接口和认证方式…'
    case 'fields': return '正在提取参数…'
    case 'test': return '正在做一次测试调用…'
    case 'commit': return '正在保存到模型库…'
  }
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'image': return '图片生成'
    case 'video': return '视频生成'
    case 'audio': return '音频生成'
    case 'text': return '文本'
    default: return kind
  }
}

export function failureLabelFor(reason?: string): string {
  if (!reason) return '出了点问题'
  if (/401|403|auth/i.test(reason)) return 'API Key 被服务器拒绝'
  if (/404/.test(reason)) return '找不到这个接口'
  if (/gave up/i.test(reason)) return '读不懂这份文档'
  if (/No successful test/i.test(reason)) return '测试调用一直没通过'
  if (/fetch/i.test(reason)) return '打不开这个文档链接'
  return '没能完成添加'
}

export function humanHintFor(reason?: string): string {
  if (!reason) return ''
  if (/401|403|auth/i.test(reason)) return '可能是 key 拷贝时多了空格，或这个 key 没开通这个模型。'
  if (/404/.test(reason)) return '文档地址可能不完整，或者这个模型已经下线。'
  if (/gave up/i.test(reason)) return '可能文档结构特殊。你可以换个更直接的端点说明页试试。'
  if (/No successful test/i.test(reason)) return '可能是参数不对，或者这个 key 余额不足。'
  if (/fetch/i.test(reason)) return '检查链接是否能在浏览器里打开。'
  return reason
}
