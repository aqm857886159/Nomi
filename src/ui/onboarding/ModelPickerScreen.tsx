/**
 * 模型勾选第二屏（OnboardingWizard 的换屏，非新弹窗）。
 *
 * 为什么：中转 `/v1/models` 常拉到上百个模型，旧流程全量灌库（opt-out，再逐个删）——污染所有
 * 模型下拉。这里改成 opt-in：拉到的池按 文本/图片/视频/配音 分组列清单，用户**默认不勾**、勾谁接谁
 * （用户拍板 2026-06-29 方案 A）。分组复用单一真相源 groupModelsByKind（Issue #23 防白屏不变量）。
 *
 * 无 wizard state：选择态本地持有，确认时回吐给宿主（R9 分层，宿主只管落库）。端点没列出模型时
 * （candidates 为空）靠底部「手填 id」补充，保留手动录入逃生口（P1 不丢能力）。
 */
import React from 'react'
import { Stack, Group, Text } from '@mantine/core'
import { IconArrowLeft, IconRefresh, IconMessage, IconPhoto, IconVideo, IconMicrophone, IconCube, IconPlus, IconCheck } from '@tabler/icons-react'
import { DesignButton, DesignCheckbox, DesignSearchInput, DesignTextInput } from '../../design'
import { groupModelsByKind } from './modelChipGrouping'
import { cn } from '../../utils/cn'

export type PickerModel = { id: string; kind: string }

const KIND_ICON: Record<string, typeof IconMessage> = {
  text: IconMessage,
  image: IconPhoto,
  video: IconVideo,
  audio: IconMicrophone,
  model3d: IconCube,
}

export function ModelPickerScreen({
  candidates,
  initialSelected,
  sourceName,
  host,
  total,
  fetching,
  onRefetch,
  onBack,
  onConfirm,
  onResolveKind,
}: {
  candidates: PickerModel[]
  /** 已选中的模型（带类型）——重开第二屏时预勾，且确保手填过的 id 仍在池里渲染。 */
  initialSelected: PickerModel[]
  sourceName: string
  host: string
  /** 拉到的总数（= candidates.length，单独传以便文案稳定）。 */
  total: number
  fetching: boolean
  onRefetch: () => void
  onBack: () => void
  onConfirm: (selected: PickerModel[]) => void
  /** 手填未列出的 id 时，向宿主问类型（宿主包 bridge.guessKinds）；缺省按 text。 */
  onResolveKind?: (id: string) => Promise<string>
}): JSX.Element {
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(initialSelected.map(m => m.id)))
  const [manual, setManual] = React.useState<PickerModel[]>([])
  const [manualInput, setManualInput] = React.useState('')
  const [query, setQuery] = React.useState('')

  // 池 = 手填 ∪ 已选 ∪ 拉到的（去重保首次）。已选放在拉取之前，保证手动加过的 id 仍渲染、
  // 且用户改过的类型优先于启发式猜测。
  const pool = React.useMemo(() => {
    const seen = new Set<string>()
    const out: PickerModel[] = []
    for (const m of [...manual, ...initialSelected, ...candidates]) {
      const id = m.id.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({ id, kind: m.kind })
    }
    return out
  }, [candidates, manual, initialSelected])

  const q = query.trim().toLowerCase()
  const visible = q ? pool.filter(m => m.id.toLowerCase().includes(q)) : pool
  const groups = groupModelsByKind(visible)

  const toggle = React.useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleGroup = React.useCallback((ids: string[]) => {
    setSelected(prev => {
      const next = new Set(prev)
      const allOn = ids.every(id => next.has(id))
      for (const id of ids) {
        if (allOn) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [])

  const addManual = React.useCallback(async () => {
    const id = manualInput.trim()
    if (!id) return
    setManualInput('')
    if (pool.some(m => m.id === id)) { setSelected(prev => new Set(prev).add(id)); return }
    let kind = 'text'
    if (onResolveKind) { try { kind = await onResolveKind(id) } catch { /* 退回 text */ } }
    setManual(prev => [{ id, kind }, ...prev])
    setSelected(prev => new Set(prev).add(id))
  }, [manualInput, pool, onResolveKind])

  const confirm = React.useCallback(() => {
    onConfirm(pool.filter(m => selected.has(m.id)))
  }, [pool, selected, onConfirm])

  const count = selected.size

  return (
    <Stack gap={10}>
      {/* 头：返回 + 标题 + 重新拉取 */}
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap={8} align="center" wrap="nowrap">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="inline-flex text-nomi-ink-60 hover:text-nomi-ink"
          >
            <IconArrowLeft size={18} stroke={1.7} />
          </button>
          <Text size="md" fw={600} c="var(--nomi-ink)">选择要添加的模型</Text>
        </Group>
        <DesignButton variant="subtle" leftSection={<IconRefresh size={13} />} onClick={onRefetch} loading={fetching}>
          重新拉取
        </DesignButton>
      </Group>

      {/* 来源行：来源名 · host · 拉到 N 个 */}
      <Text size="xs" c="var(--nomi-ink-60)" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {sourceName ? `${sourceName} · ` : ''}{host}{total > 0 ? ` · 拉到 ${total} 个` : ''}
      </Text>

      <DesignSearchInput value={query} onChange={setQuery} placeholder="搜索模型 id…" className="w-full" />

      {/* 计数 + 清空 */}
      <Group justify="space-between" align="center">
        <Text size="sm" c="var(--nomi-ink-60)">
          已选 <Text span fw={600} c="var(--nomi-ink)">{count}</Text>{total > 0 ? ` / 共 ${total}` : ''}
        </Text>
        {count > 0 && (
          <button type="button" onClick={() => setSelected(new Set())} className="text-body-sm text-nomi-ink-40 hover:text-nomi-ink-60">
            清空
          </button>
        )}
      </Group>

      {/* 分组清单 */}
      <Stack gap={4} mah={260} style={{ overflowY: 'auto' }}>
        {groups.length === 0 ? (
          <Text size="sm" c="var(--nomi-ink-40)" py={16} ta="center">
            {pool.length === 0 ? '这个地址没列出模型，在下方手填模型 id' : '没有匹配的模型'}
          </Text>
        ) : (
          groups.map(({ kind, label, models }) => {
            const ids = models.map(m => m.id)
            const allOn = ids.every(id => selected.has(id))
            const Icon = KIND_ICON[kind] ?? IconMessage
            return (
              <Stack key={kind} gap={2}>
                <Group justify="space-between" align="center" px={2} pt={6}>
                  <Group gap={5} align="center" wrap="nowrap">
                    <Icon size={14} stroke={1.6} style={{ color: 'var(--nomi-ink-60)' }} />
                    <Text size="xs" fw={600} c="var(--nomi-ink-60)">
                      {label} <Text span fw={400} c="var(--nomi-ink-40)">{models.length}</Text>
                    </Text>
                  </Group>
                  <button type="button" onClick={() => toggleGroup(ids)} className="text-micro text-nomi-accent hover:underline">
                    {allOn ? '取消本组' : '全选本组'}
                  </button>
                </Group>
                {models.map(m => {
                  const on = selected.has(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(m.id)}
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-1.5 rounded-nomi text-left w-full',
                        'transition-colors duration-100 hover:bg-nomi-ink-05',
                      )}
                    >
                      <DesignCheckbox checked={on} readOnly tabIndex={-1} aria-hidden />
                      <span
                        className="text-body-sm text-nomi-ink truncate"
                        style={{ fontFamily: 'var(--nomi-font-mono, monospace)' }}
                      >
                        {m.id}
                      </span>
                    </button>
                  )
                })}
              </Stack>
            )
          })
        )}
      </Stack>

      {/* 手填未列出的 id（逃生口） */}
      <Group gap={6} wrap="nowrap" align="center">
        <DesignTextInput
          value={manualInput}
          onChange={e => setManualInput(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addManual() } }}
          placeholder="没列出来的，输入模型 id 回车添加"
          style={{ flex: 1 }}
        />
        <DesignButton variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => void addManual()} disabled={!manualInput.trim()}>
          添加
        </DesignButton>
      </Group>

      {/* 底：取消 + 添加 N */}
      <Group justify="flex-end" gap={8} pt={2}>
        <DesignButton variant="subtle" onClick={onBack}>取消</DesignButton>
        <DesignButton variant="filled" leftSection={<IconCheck size={14} />} onClick={confirm} disabled={count === 0}>
          添加 {count} 个模型
        </DesignButton>
      </Group>
    </Stack>
  )
}
